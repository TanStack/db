import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { createTransaction } from '../../src/transactions.js'
import { stripVirtualProps } from '../utils.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import { declareOracle } from '../oracle-declaration.js'
import type { SyncConfig } from '../../src/types.js'

// Law: while an optimistic delete hides a derived row, synced batches for the
// source are queued in the derived collection and publish nothing until the
// transaction settles. After settlement, the derived collection and its
// downstream hold the source's committed rows, whatever the batches'
// membership deltas and whether the delete was acknowledged or rolled back.
// Membership lookups run only for batches that carry an update. The check
// (runFlushHistory) runs generated queue histories and compares the output
// with the source rows it wrote. The model predicts the final rows of the
// parameter grid. Unit tests for the same subsystem are in
// derived-delete-reconciliation.test.ts.

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

// The derived collection's committed rows after the queued batches settle:
// row 1 keeps the last update, and each batch inserts row 2 + index. Row 2 is
// updated to 40 by the second batch, so it keeps 40 when more than one batch
// runs, and it keeps the value of its own insert otherwise.
function expectedRowsAfterQueuedBatches(batches: number): Array<Row> {
  return [
    { id: 1, value: 19 + batches },
    ...Array.from({ length: batches }, (_, index) => ({
      id: 2 + index,
      value: batches > 1 && index === 0 ? 40 : 30 + index,
    })),
  ]
}

declareOracle({
  check: [runFlushHistory],
  model: [expectedRowsAfterQueuedBatches],
})

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
          const expected = expectedRowsAfterQueuedBatches(batches)
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
