import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createTransaction } from '../src/transactions.js'
import { createLiveQueryCollection } from '../src/query/index.js'
import type { ChangeMessage, SyncConfig } from '../src/types.js'
import type { WithVirtualProps } from '../src/virtual-props.js'

type Row = { id: string; position: number }

/**
 * `commitPendingTransactions` derives the keys it may emit events for from a
 * sync transaction's operations *and* its row metadata writes, because a
 * metadata-only transaction still flips virtual props ($synced / $origin) when
 * it retires a completed optimistic mutation. `capturePreSyncVisibleState` only
 * looked at the operations, so a metadata-only sync transaction left its key out
 * of `recentlySyncedKeys`. `recomputeOptimisticState` then emitted that same
 * transition into the batch, and the force-emit at the end of the sync commit
 * concatenated the two — publishing one key twice in a single batch.
 *
 * Downstream that is a malformed diff: the live query counts the old row at -2
 * and the new one at +2, so the next optimistic write on the key leaves two
 * positive contributors and the keyed reduction throws "Query contributors with
 * the same row key are not congruent".
 *
 * See https://github.com/TanStack/db/issues/1767
 */
describe(`metadata-only sync commits`, () => {
  it(`publishes one event per key when retiring an optimistic mutation`, async () => {
    let syncApi!: Parameters<SyncConfig<Row, string>[`sync`]>[0]

    const rows = createCollection<Row, string>({
      id: `metadata-only-sync-rows`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: (params) => {
          syncApi = params
          params.begin()
          params.write({ type: `insert`, value: { id: `r1`, position: 0 } })
          params.commit()
          params.markReady()
        },
      },
    })

    const liveRows = createLiveQueryCollection((q) => q.from({ row: rows }))
    await liveRows.preload()

    const batches: Array<
      Array<ChangeMessage<WithVirtualProps<Row, string>, string>>
    > = []
    rows.subscribeChanges((changes) => {
      batches.push(changes)
    })

    // Mirrors what an adapter does when a write is acknowledged: apply the
    // server row, then record bookkeeping metadata for the key. The metadata
    // write lands in its own sync transaction that carries no row operations,
    // and stays pending until the user transaction finishes persisting.
    const round = (position: number) =>
      createTransaction({
        mutationFn: async () => {
          syncApi.begin({ immediate: true })
          syncApi.write({ type: `update`, value: { id: `r1`, position } })
          syncApi.commit()

          syncApi.begin()
          syncApi.metadata?.row.set(`r1`, { syncedAt: position })
          syncApi.commit()
        },
      }).mutate(() => {
        rows.update(`r1`, (draft) => {
          draft.position = draft.position + 1
        })
      })

    await round(1).isPersisted.promise
    // Before the fix the batch above named `r1` twice, which corrupted the live
    // query's multiplicity bookkeeping and made this second round throw.
    await round(2).isPersisted.promise

    expect(rows.get(`r1`)?.position).toBe(2)
    expect(liveRows.get(`r1`)?.position).toBe(2)
    expect(rows._state.syncedMetadata.get(`r1`)).toEqual({ syncedAt: 2 })

    // A published batch is a diff, so it must never name one key twice.
    for (const batch of batches) {
      const keys = batch.map((change) => change.key)
      expect(keys).toEqual([...new Set(keys)])
    }
  })
})
