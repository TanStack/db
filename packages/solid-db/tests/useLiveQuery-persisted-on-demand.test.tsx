import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@solidjs/testing-library'
import { Suspense } from 'solid-js'
import { createCollection, eq } from '@tanstack/db'
import {
  SQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
} from '../../db-sqlite-persistence-core/src'
import { useLiveQuery } from '../src/useLiveQuery'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { SQLiteDriver } from '../../db-sqlite-persistence-core/src'

/**
 * # Does Solid Suspense release offline on a covered on-demand demand?
 *
 * Receiving witness for persisted demand coverage
 * (`db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`)
 * through Solid Suspense and a real persisted on-demand Collection on
 * `node:sqlite`. Session 1 is online and either loads `group = 'a'` or loads
 * nothing. Session 2 is offline: its source never answers. With
 * `networkTimeoutMs: 0`, a covered demand settles from SQLite, so Suspense
 * renders the restored rows. A demand that session 1 never loaded keeps the
 * fallback. Limits: one filter and one Solid render path.
 */

type Row = { id: string; group: string }

function toBinding(value: unknown): string | number | bigint | null {
  if (value === null || value === undefined) return null
  if (typeof value === `boolean`) return value ? 1 : 0
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  ) {
    return value
  }
  return String(value)
}

// Work outside a transaction waits behind an active transaction, as the
// driver contract requires.
function createDriver(database: DatabaseSync): SQLiteDriver {
  let tail: Promise<unknown> = Promise.resolve()
  const serialize = <T,>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  const direct: SQLiteDriver = {
    exec: (sql) => {
      database.exec(sql)
      return Promise.resolve()
    },
    query: (sql, params = []) =>
      Promise.resolve(
        database
          .prepare(sql)
          .all(...params.map(toBinding))
          .map((row) => ({ ...row })) as Array<never>,
      ),
    run: (sql, params = []) => {
      database.prepare(sql).run(...params.map(toBinding))
      return Promise.resolve()
    },
    transaction: (transaction) => transaction(direct),
  }
  return {
    exec: (sql) => serialize(() => direct.exec(sql)),
    query: (sql, params) => serialize(() => direct.query(sql, params)),
    run: (sql, params) => serialize(() => direct.run(sql, params)),
    transaction: (transaction) =>
      serialize(async () => {
        database.exec(`BEGIN IMMEDIATE`)
        try {
          const result = await transaction(direct)
          database.exec(`COMMIT`)
          return result
        } catch (error) {
          database.exec(`ROLLBACK`)
          throw error
        }
      }),
  }
}

function source(driver: SQLiteDriver, online: boolean) {
  const calls: Array<LoadSubsetOptions> = []
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `solid-demand-coverage`,
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

function GroupA(props: {
  collection: ReturnType<typeof source>[`collection`]
}) {
  const query = useLiveQuery((q) =>
    q.from({ row: props.collection }).where(({ row }) => eq(row.group, `a`)),
  )
  return (
    <div data-testid="rows">
      {query()
        .map((row) => row.id)
        .sort()
        .join(`,`) || `empty`}
    </div>
  )
}

describe(`Solid Suspense over a persisted on-demand Collection offline`, () => {
  it.each([
    [`loaded group a`, `a1,a2`],
    [`nothing`, undefined],
  ] as const)(`session 1: %s`, async (session1, rendered) => {
    vi.spyOn(console, `warn`).mockImplementation(() => {})
    vi.spyOn(console, `error`).mockImplementation(() => {})
    const driver = createDriver(new DatabaseSync(`:memory:`))
    if (session1 === `loaded group a`) {
      const first = source(driver, true)
      const view = render(() => (
        <Suspense fallback={<div data-testid="waiting">Loading</div>}>
          <GroupA collection={first.collection} />
        </Suspense>
      ))
      const content = await view.findByTestId(`rows`)
      await waitFor(() => expect(content.textContent).toBe(`a1,a2`))
      view.unmount()
      await new Promise((resolve) => setTimeout(resolve, 50))
      await first.collection.cleanup()
    }

    const second = source(driver, false)
    const view = render(() => (
      <Suspense fallback={<div data-testid="waiting">Loading</div>}>
        <GroupA collection={second.collection} />
      </Suspense>
    ))
    try {
      // Positive witness: session 2 asked the offline source for group a.
      await waitFor(() => expect(second.calls.length).toBeGreaterThan(0))
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (rendered) {
        const content = await view.findByTestId(`rows`)
        expect(content.textContent).toBe(rendered)
      } else {
        expect(view.getByTestId(`waiting`)).toBeTruthy()
      }
    } finally {
      view.unmount()
      await second.collection.cleanup()
    }
  })
})
