import { DatabaseSync } from 'node:sqlite'
import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { describe, expect, it, vi } from 'vitest'
import { createCollection, eq } from '@tanstack/db'
import {
  SQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
} from '../../db-sqlite-persistence-core/src'
import { injectLiveQuery } from '../src/index'
import { createSerializedNodeSqliteDriver as createDriver } from '../../db-sqlite-persistence-core/tests/helpers/node-sqlite-driver'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { SQLiteDriver } from '../../db-sqlite-persistence-core/src'

/**
 * # Does an Angular live query settle offline on a covered on-demand demand?
 *
 * Receiving witness for persisted demand coverage
 * (`db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`)
 * through Angular `injectLiveQuery` and a real persisted on-demand Collection
 * on `node:sqlite`.
 *
 * Law: with `initialRender: { strategy: 'network-first', networkTimeoutMs }`
 * on a persisted `syncMode: 'on-demand'` Collection, a demand that an earlier
 * online session loaded (covered) settles from SQLite in an offline session
 * after the wait. A demand never loaded online stays loading.
 *
 * Histories: session 1 is online and loads `group = 'a'` (or loads nothing).
 * Session 2 is offline: its source never answers and records each demand it
 * is asked for. Each session runs in its own environment injector, which
 * stands in for a component's lifetime and is destroyed after the session.
 *
 * Production path: `injectLiveQuery` -> `createLiveQueryObserver` (wholesale
 * mode) -> the live query's on-demand `loadSubset` -> the persisted wrapper,
 * which waits for the network-first wait and then settles a covered demand
 * from its restored rows.
 *
 * Public observation and checkpoint: after a 100 ms settle, the signals
 * `isReady`, `isLoading`, `persistedStatus`, and `data`. The positive witness
 * first checks that session 2 asked the offline source for `group = 'a'`.
 *
 * Limits: Angular does not consume the network-first initial-render gate.
 * `preloadForInitialRender` and `isInitialRenderReady` are called only by
 * `react-db` (`useLiveSuspenseQuery.ts`, `useLiveQuery.ts`) and `solid-db`
 * (`useLiveQuery.ts`). This witness therefore checks the wrapper's settlement
 * through query readiness and rows, not an Angular render gate. It uses one
 * filter, one injection per session, and no template rendering.
 */

type Row = { id: string; group: string }

function source(driver: SQLiteDriver, online: boolean) {
  const calls: Array<LoadSubsetOptions> = []
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `angular-demand-coverage`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      initialRender: { strategy: `network-first`, networkTimeoutMs: 0 },
      persistence: { adapter: new SQLiteCorePersistenceAdapter({ driver }) },
      sync: {
        sync: ({ begin, write, commit }) => ({
          loadSubset: (options: LoadSubsetOptions) => {
            calls.push(options)
            if (!online) return new Promise<void>(() => {})
            begin()
            for (const id of [`a1`, `a2`]) {
              write({ type: `insert`, value: { id, group: `a` } })
            }
            return Promise.resolve(commit()).then(() => undefined)
          },
        }),
      },
    }),
  )
  return { collection, calls }
}

function groupA(
  injector: EnvironmentInjector,
  collection: ReturnType<typeof source>[`collection`],
) {
  return injector.runInContext(() =>
    injectLiveQuery((q) =>
      q.from({ row: collection }).where(({ row }) => eq(row.group, `a`)),
    ),
  )
}

function rowIds(query: ReturnType<typeof groupA>): string {
  return (
    query
      .data()
      .map((row) => row.id)
      .sort()
      .join(`,`) || `empty`
  )
}

describe(`Angular injectLiveQuery over a persisted on-demand Collection offline`, () => {
  it.each([
    [`loaded group a`, `a1,a2`],
    [`nothing`, undefined],
  ] as const)(`session 1: %s`, async (session1, rendered) => {
    vi.spyOn(console, `warn`).mockImplementation(() => {})
    vi.spyOn(console, `error`).mockImplementation(() => {})
    const parent = TestBed.inject(EnvironmentInjector)
    const driver = createDriver(new DatabaseSync(`:memory:`))
    if (session1 === `loaded group a`) {
      const firstInjector = createEnvironmentInjector([], parent)
      const first = source(driver, true)
      const query = groupA(firstInjector, first.collection)
      await vi.waitFor(() => expect(query.isReady()).toBe(true))
      expect(rowIds(query)).toBe(`a1,a2`)
      firstInjector.destroy()
      await new Promise((resolve) => setTimeout(resolve, 50))
      await first.collection.cleanup()
    }

    const secondInjector = createEnvironmentInjector([], parent)
    const second = source(driver, false)
    const query = groupA(secondInjector, second.collection)
    try {
      // Positive witness: session 2 asked the offline source for group a.
      await vi.waitFor(() => expect(second.calls.length).toBeGreaterThan(0))
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (rendered) {
        await vi.waitFor(() => expect(query.isReady()).toBe(true))
        expect(rowIds(query)).toBe(rendered)
      } else {
        expect(query.isReady()).toBe(false)
        expect(query.isLoading()).toBe(true)
        expect(rowIds(query)).toBe(`empty`)
      }
    } finally {
      secondInjector.destroy()
      await second.collection.cleanup()
    }
  })
})
