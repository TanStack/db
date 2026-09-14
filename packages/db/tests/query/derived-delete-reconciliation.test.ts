import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { createTransaction } from '../../src/transactions.js'
import { stripVirtualProps } from '../utils.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import type { SyncConfig } from '../../src/types.js'

type Row = { id: number; value: number }
type WritePhase = `initial` | `update` | `insert`
const cases = ([`pass-through`, `order`, `select`] as const).flatMap((shape) =>
  [false, true].flatMap((layered) =>
    ([`acknowledge`, `rollback`] as const).flatMap((outcome) =>
      [1, 2].map((batches) => ({ shape, layered, outcome, batches })),
    ),
  ),
)

// The model owns source rows; production owns graph deltas and queued output.
// Work is checked at each flush, not just for one final batch size.
const flushHistory = fc.array(
  fc.record({
    inserts: fc.integer({ min: 1, max: 5 }),
    update: fc.boolean(),
  }),
  { minLength: 1, maxLength: 12 },
)
async function runFlushHistory(
  steps: Array<{ inserts: number; update: boolean }>,
  prepareDriverRow: (row: Row, phase: WritePhase) => Row = (row) => row,
) {
  let sync!: Parameters<SyncConfig<Row>[`sync`]>[0]
  const expected = new Map([[1, { id: 1, value: 0 }]])
  const source = createCollection<Row>({
    getKey: (row) => row.id,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({
          type: `insert`,
          value: prepareDriverRow({ ...expected.get(1)! }, `initial`),
        })
        actions.commit()
        actions.markReady()
      },
    },
  })
  const derived = createLiveQueryCollection({
    query: (q) => q.from({ row: source }),
  })
  const done = createDeferred<void>()
  const tx = createTransaction({ mutationFn: () => done.promise })
  const settled = tx.isPersisted.promise.catch((error: unknown) => error)
  const lookup = vi.spyOn(derived._state, `createSyncedKeyLookup`)
  try {
    await derived.preload()
    tx.mutate(() => derived.delete(1))
    for (const [index, step] of steps.entries()) {
      lookup.mockClear()
      sync.begin()
      if (step.update) {
        const row = { id: 1, value: index + 1 }
        expected.set(1, row)
        sync.write({
          type: `update`,
          value: prepareDriverRow({ ...row }, `update`),
        })
      }
      for (let offset = 0; offset < step.inserts; offset++) {
        const row = { id: expected.size + 1, value: index }
        expected.set(row.id, row)
        sync.write({
          type: `insert`,
          value: prepareDriverRow({ ...row }, `insert`),
        })
      }
      expect(sync.commit()).toBe(true)
      expect(lookup, `flush ${index}`).toHaveBeenCalledTimes(
        step.update ? 1 : 0,
      )
      expect(derived._state.pendingSyncedTransactions).toHaveLength(index + 1)
      expect([...derived.values()]).toEqual([])
    }
    done.resolve()
    await settled
    expect([...derived.values()].map((row) => stripVirtualProps(row))).toEqual([
      ...expected.values(),
    ])
  } finally {
    done.resolve()
    await settled
    lookup.mockRestore()
    await derived.cleanup()
    await source.cleanup()
  }
}

it.each([`initial`, `update`, `insert`] as const)(
  `detects driver-only row mutation at the %s boundary`,
  async (phase) => {
    const steps = [{ inserts: 2, update: phase === `update` }]
    await expect(
      runFlushHistory(steps, (row, at) => {
        if (at === phase) row.value += 100
        return row
      }),
    ).rejects.toMatchObject({ name: `AssertionError` })
    await runFlushHistory(steps)
  },
)

fcTest.prop([flushHistory], { numRuns: oracleRuns(40), seed: 41703 })(
  `shares membership work only for balanced deltas across fixed queue histories`,
  runFlushHistory,
)
fcTest.prop(
  [flushHistory],
  oraclePropertyOptions(60, `derived-publication.membership-work`),
)(
  `shares membership work only for balanced deltas across random queue histories`,
  runFlushHistory,
)

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
          deletedKeys: new Set(),
          rowMetadataWrites: new Map(),
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
      const settled = tx.isPersisted.promise.catch(() => {})
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

  it.each(cases)(
    `$shape / layered=$layered / $outcome / $batches batches`,
    async ({ shape, layered, outcome, batches }) => {
      let sync!: Parameters<SyncConfig<Row>[`sync`]>[0]
      const source = createCollection<Row>({
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            sync = params
            params.begin()
            params.write({ type: `insert`, value: { id: 1, value: 10 } })
            params.commit()
            params.markReady()
          },
        },
      })
      const middle = createLiveQueryCollection({
        query: (q) => q.from({ row: source }),
      })
      const derived = createLiveQueryCollection({
        query: (q) => {
          const query = q.from({ row: layered ? middle : source })
          if (shape === `order`) return query.orderBy(({ row }) => row.value)
          if (shape === `select`)
            return query.fn.select(({ row }) => ({ ...row }))
          return query
        },
      })
      const downstream = createLiveQueryCollection({
        query: (q) => q.from({ row: derived }),
      })
      const done = createDeferred<void>()
      const tx = createTransaction({ mutationFn: () => done.promise })
      const settled = tx.isPersisted.promise.catch((error: unknown) => error)
      const read = (collection: { values: () => Iterable<Row> }) =>
        [...collection.values()]
          .map((row) => ({ id: row.id, value: row.value }))
          .sort((a, b) => a.id - b.id)
      try {
        await downstream.preload()
        tx.mutate(() => derived.delete(1))
        const reconstructed = new Map<string | number, Row>()
        const subscription = derived.subscribeChanges((changes) => {
          for (const change of changes) {
            if (change.type === `delete`) reconstructed.delete(change.key)
            else reconstructed.set(change.key, stripVirtualProps(change.value))
          }
          expect(
            [...reconstructed.values()].sort((a, b) => a.id - b.id),
          ).toEqual(read(derived))
        })
        try {
          for (let index = 0; index < batches; index++) {
            sync.begin()
            sync.write({ type: `update`, value: { id: 1, value: 20 + index } })
            if (index > 0)
              sync.write({ type: `update`, value: { id: 2, value: 40 } })
            sync.write({
              type: `insert`,
              value: { id: 2 + index, value: 30 + index },
            })
            expect(sync.commit()).toBe(true)
            // The whole graph-output batch remains queued, including the insert.
            expect(read(derived)).toEqual([])
            expect(read(downstream)).toEqual([])
          }
          if (outcome === `rollback`) done.reject(new Error(`Rejected delete`))
          else done.resolve()
          await settled
          const expected = [
            { id: 1, value: 19 + batches },
            ...Array.from({ length: batches }, (_, index) => ({
              id: 2 + index,
              value: batches > 1 && index === 0 ? 40 : 30 + index,
            })),
          ]
          expect(read(derived)).toEqual(expected)
          expect(read(downstream)).toEqual(expected)
        } finally {
          subscription.unsubscribe()
        }
      } finally {
        done.resolve()
        await settled
        await downstream.cleanup()
        await derived.cleanup()
        await middle.cleanup()
        await source.cleanup()
      }
    },
  )
})
