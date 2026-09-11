import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { createTransaction } from '../../src/transactions.js'
import { stripVirtualProps } from '../utils.js'
import type { SyncConfig } from '../../src/types.js'

type Row = { id: number; value: number }
const cases = ([`pass-through`, `order`, `select`] as const).flatMap((shape) =>
  [false, true].flatMap((layered) =>
    ([`acknowledge`, `rollback`] as const).flatMap((outcome) =>
      [1, 2].map((batches) => ({ shape, layered, outcome, batches })),
    ),
  ),
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
