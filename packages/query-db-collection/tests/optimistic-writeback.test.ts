import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import {
  createCollection,
  createLiveQueryCollection,
  createTransaction,
} from '@tanstack/db'
import { queryCollectionOptions } from '../src/query'

type Row = { id: string; position: number }

describe(`optimistic writes acknowledged by writeUpsert`, () => {
  // `writeUpsert` refreshes the query cache after it commits, and applying that
  // result writes row ownership metadata. That metadata write lands in a sync
  // transaction carrying no row operations, which used to make the collection
  // publish the key twice in one batch when the optimistic mutation retired.
  // The duplicated diff corrupted the live query's multiplicity bookkeeping, so
  // the second round threw "Query contributors with the same row key are not
  // congruent" out of `Transaction.mutate`, before its own mutationFn ever ran.
  // See https://github.com/TanStack/db/issues/1767
  it(`survives two consecutive optimistic-then-synced writes on one key`, async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    // Live server state, so a refetch can never resurrect a stale row.
    const server = { position: 0 }

    const rows = createCollection(
      queryCollectionOptions<Row>({
        id: `rows`,
        queryClient,
        queryKey: [`rows`],
        queryFn: async () => [{ id: `r1`, position: server.position }],
        getKey: (row) => row.id,
      }),
    )

    const liveRows = createLiveQueryCollection((q) => q.from({ row: rows }))
    await liveRows.preload()

    const round = (position: number) => {
      const tx = createTransaction({
        mutationFn: async () => {
          server.position = position // the server accepted the write
          rows.utils.writeUpsert({ id: `r1`, position })
        },
      })
      tx.mutate(() => {
        rows.update(`r1`, (draft) => {
          draft.position = draft.position + 1
        })
      })
      return tx
    }

    await round(1).isPersisted.promise
    await round(2).isPersisted.promise

    expect(rows.get(`r1`)?.position).toBe(2)
    expect(liveRows.get(`r1`)?.position).toBe(2)
  })
})
