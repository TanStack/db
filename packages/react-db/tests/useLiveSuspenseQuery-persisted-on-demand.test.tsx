import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { act, render as renderComponent, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { createCollection, eq } from '@tanstack/db'
import {
  SQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
} from '../../db-sqlite-persistence-core/src'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { createSerializedNodeSqliteDriver as createDriver } from '../../db-sqlite-persistence-core/tests/helpers/node-sqlite-driver'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { SQLiteDriver } from '../../db-sqlite-persistence-core/src'

/**
 * # Does React Suspense release offline on a covered on-demand demand?
 *
 * Receiving witness for persisted demand coverage
 * (`db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`)
 * through React Suspense and a real persisted on-demand Collection on
 * `node:sqlite`. Session 1 is online and either loads `group = 'a'` or loads
 * nothing. Session 2 is offline: its source never answers. With
 * `networkTimeoutMs: 0`, a covered demand settles from SQLite, so Suspense
 * renders the restored rows. A demand that session 1 never loaded keeps the
 * fallback. Limits: one filter, one React render path, no StrictMode.
 */

type Row = { id: string; group: string }

function source(driver: SQLiteDriver, online: boolean) {
  const calls: Array<LoadSubsetOptions> = []
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `react-demand-coverage`,
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

function GroupA({
  collection,
}: {
  collection: ReturnType<typeof source>[`collection`]
}) {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ row: collection }).where(({ row }) => eq(row.group, `a`)),
  )
  return (
    <div>
      {data
        .map((row) => row.id)
        .sort()
        .join(`,`) || `empty`}
    </div>
  )
}

describe(`React Suspense over a persisted on-demand Collection offline`, () => {
  it.each([
    [`loaded group a`, `a1,a2`],
    [`nothing`, undefined],
  ] as const)(`session 1: %s`, async (session1, rendered) => {
    vi.spyOn(console, `warn`).mockImplementation(() => {})
    vi.spyOn(console, `error`).mockImplementation(() => {})
    const driver = createDriver(new DatabaseSync(`:memory:`))
    if (session1 === `loaded group a`) {
      const first = source(driver, true)
      const view = renderComponent(
        <Suspense fallback={<div>Loading</div>}>
          <GroupA collection={first.collection} />
        </Suspense>,
      )
      await waitFor(() => expect(view.getByText(`a1,a2`)).toBeTruthy())
      view.unmount()
      await new Promise((resolve) => setTimeout(resolve, 50))
      await first.collection.cleanup()
    }

    const second = source(driver, false)
    const view = renderComponent(
      <Suspense fallback={<div>Loading</div>}>
        <GroupA collection={second.collection} />
      </Suspense>,
    )
    try {
      // Positive witness: session 2 asked the offline source for group a.
      await waitFor(() => expect(second.calls.length).toBeGreaterThan(0))
      await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
      if (rendered) {
        await waitFor(() => expect(view.getByText(rendered)).toBeTruthy())
      } else {
        expect(view.getByText(`Loading`)).toBeTruthy()
      }
    } finally {
      view.unmount()
      await second.collection.cleanup()
    }
  })
})
