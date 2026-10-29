// Unit tests for derived collections beneath optimistic deletes: committed
// membership and value reads while queued batches wait for the delete to
// settle. The law and its oracle owner are in
// derived-delete-reconciliation-oracle.test.ts.
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { createTransaction } from '../../src/transactions.js'
import { stripVirtualProps } from '../utils.js'
import type { SyncConfig } from '../../src/types.js'

type Row = { id: number; value: number }

describe(`derived updates beneath optimistic deletes`, () => {
  it.each([false, true])(
    `uses committed last writes and truncate=%s for membership`,
    async (truncate) => {
      const collection = createCollection<Row>({
        getKey: (row) => row.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({ type: `insert`, value: { id: 1, value: 0 } })
            write({ type: `insert`, value: { id: 2, value: 0 } })
            commit()
            markReady()
          },
        },
      })
      try {
        await collection.preload()
        const batch = (
          committed: boolean,
        ): (typeof collection._state.pendingSyncedTransactions)[number] => ({
          committed,
          applicationStarted: false,
          layoutChanged: false,
          operations: [],
          rowMetadataWrites: new Map(),
          explicitRowMetadataWrites: new Map(),
          collectionMetadataWrites: new Map(),
          applied: createDeferred<void>(),
        })
        const earlier = batch(true)
        earlier.operations.push({
          type: `insert`,
          key: 3,
          value: { id: 3, value: 0 },
        })
        const later = batch(true)
        later.truncate = truncate
        later.operations.push(
          { type: `delete`, key: 1, value: { id: 1, value: 0 } },
          { type: `insert`, key: 4, value: { id: 4, value: 0 } },
          { type: `delete`, key: 4, value: { id: 4, value: 0 } },
          { type: `insert`, key: 1, value: { id: 1, value: 1 } },
        )
        const uncommitted = batch(false)
        uncommitted.truncate = true
        uncommitted.operations.push({
          type: `insert`,
          key: 5,
          value: { id: 5, value: 0 },
        })
        // Directly exercise the membership snapshot; a real truncate normally
        // drains immediately and must not be delayed just to construct this case.
        collection._state.pendingSyncedTransactions.push(
          earlier,
          later,
          uncommitted,
        )
        const hasKey = collection._state.createSyncedKeyLookup()
        expect([1, 2, 3, 4, 5].map(hasKey)).toEqual([
          true,
          !truncate,
          !truncate,
          false,
          false,
        ])
      } finally {
        for (const batch of collection._state.pendingSyncedTransactions)
          batch.applied.resolve()
        collection._state.pendingSyncedTransactions.length = 0
        await collection.cleanup()
      }
    },
  )

  it.each([64, 256])(
    `classifies %i queued updates with linear membership work`,
    async (count) => {
      let sync!: Parameters<SyncConfig<Row>[`sync`]>[0]
      const source = createCollection<Row>({
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            sync = params
            params.begin()
            for (let id = 0; id < count; id++)
              params.write({ type: `insert`, value: { id, value: 0 } })
            params.commit()
            params.markReady()
          },
        },
      })
      const derived = createLiveQueryCollection({
        query: (q) => q.from({ row: source }),
      })
      const done = createDeferred<void>()
      const tx = createTransaction({ mutationFn: () => done.promise })
      const settled = tx.when('settled').catch(() => {})
      try {
        await derived.preload()
        tx.mutate(() => derived.delete(0))
        const publish = (value: number) => {
          sync.begin()
          for (let id = 0; id < count; id++)
            sync.write({ type: `update`, value: { id, value } })
          expect(sync.commit()).toBe(true)
        }
        publish(1)
        let keyReads = 0
        const queued = derived._state.pendingSyncedTransactions.flatMap(
          (batch) => batch.operations,
        )
        expect(queued).toHaveLength(count)
        for (const operation of queued) {
          const key = operation.key
          Object.defineProperty(operation, `key`, {
            configurable: true,
            get: () => {
              keyReads++
              return key
            },
          })
        }
        publish(2)
        expect(keyReads).toBeLessThanOrEqual(count * 4)
        done.resolve()
        await settled
        expect(
          [...derived.values()].map((row) => stripVirtualProps(row)),
        ).toEqual(Array.from({ length: count }, (_, id) => ({ id, value: 2 })))
      } finally {
        done.resolve()
        await settled
        await derived.cleanup()
        await source.cleanup()
      }
    },
  )
})
