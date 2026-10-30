/** Real Collection and Effect receivers for the ordered-work owner. Adapter
 * holds control joined acquisition; observations include every publication and
 * the current public result at each cut. The owner supplies independent truth.
 */
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import {
  Query,
  createLiveQueryCollection,
  eq,
  isUndefined,
  not,
} from '../../src/query/index.js'
import { createEffect } from '../../src/query/effect.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { flushPromises, withOracleCleanup } from '../utils.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

export type OrderedJoinedPlanHistory = {
  receiver: `collection` | `effect`
  direction: `asc` | `desc`
  filter: `some` | `none`
  placement: `direct` | `wrapped` | `two-filters`
  width: 1 | 2
  releaseFirst: `first` | `second`
  blocker: `first` | `second`
}
export type OrderedPlanRow = { id: number; rank: number }
export type OrderedJoinedPlanObservation = {
  cut: `initial` | `held` | `partial` | `settled`
  pending: number
  rows: Array<number>
  publications: Array<Array<number>>
}
export async function receiveOrderedJoinedPlanHistory(
  history: OrderedJoinedPlanHistory,
  check: (observation: OrderedJoinedPlanObservation) => void,
) {
  type Marker = { id: number; rowId: number }
  let rowSync!: Parameters<SyncConfig<OrderedPlanRow, number>[`sync`]>[0]
  let holding = false
  const held: Array<{
    source: `first` | `second`
    options: LoadSubsetOptions
    answer: () => void
  }> = []
  const rows = createCollection({
    id: `ordered-plan-rows`,
    getKey: (row: OrderedPlanRow) => row.id,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    syncMode: `on-demand`,
    sync: {
      sync: (operations) => {
        rowSync = operations
        operations.begin()
        for (const id of [1, 2, 3])
          operations.write({ type: `insert`, value: { id, rank: id } })
        operations.commit()
        operations.markReady()
        return { loadSubset: () => true }
      },
    },
  })
  const markerSource = (source: `first` | `second`, marked: Array<number>) => {
    const collection = createCollection({
      id: `ordered-plan-${source}`,
      getKey: (marker: Marker) => marker.id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          operations.markReady()
          return {
            loadSubset: (options) => {
              const answer = () => {
                if (options.signal?.aborted) return
                operations.begin()
                for (const id of marked) {
                  const value = { id, rowId: id }
                  if (
                    options.where &&
                    evaluateReferenceExpression(options.where, value) !== true
                  )
                    continue
                  operations.write({
                    type: collection.has(id) ? `update` : `insert`,
                    value,
                  })
                }
                operations.commit()
              }
              if (holding)
                return new Promise<void>((resolve) =>
                  held.push({
                    source,
                    options,
                    answer: () => {
                      answer()
                      resolve()
                    },
                  }),
                )
              answer()
              return true
            },
          }
        },
      },
    })
    return collection
  }
  const firstSource = markerSource(
    `first`,
    history.blocker === `first` ? [1, 4] : [1],
  )
  const secondSource = markerSource(
    `second`,
    history.blocker === `second` ? [1, 4] : [1],
  )
  const inner = new Query()
    .from({ row: rows })
    .leftJoin({ first: firstSource }, ({ row, first }) =>
      eq(row.id, first.rowId),
    )
    .where(({ first }) =>
      history.filter === `none`
        ? isUndefined(first.id)
        : not(isUndefined(first.id)),
    )
    .orderBy(({ row }) => row.rank, history.direction)
    .limit(history.placement === `direct` ? history.width : 3)
    .select(({ row }) => row)
  const query =
    history.placement === `direct`
      ? inner
      : history.placement === `wrapped`
        ? new Query()
            .from({ nested: inner })
            .orderBy(({ nested }) => nested.rank, history.direction)
            .limit(history.width)
            .select(({ nested }) => nested)
        : new Query()
            .from({ nested: inner })
            .leftJoin({ second: secondSource }, ({ nested, second }) =>
              eq(nested.id, second.rowId),
            )
            .where(({ second }) =>
              history.filter === `none`
                ? isUndefined(second.id)
                : not(isUndefined(second.id)),
            )
            .orderBy(({ nested }) => nested.rank, history.direction)
            .limit(history.width)
            .select(({ nested }) => nested)
  const effectRows = new Map<string | number, OrderedPlanRow>()
  let publications: Array<Array<number>> = []
  const readEffect = () =>
    [...effectRows.values()]
      .sort((a, b) =>
        history.direction === `asc` ? a.rank - b.rank : b.rank - a.rank,
      )
      .map(({ id }) => id)
  let cleanupReceiver: () => void | Promise<void> = () => {}
  let read = readEffect
  await withOracleCleanup(async () => {
    if (history.receiver === `collection`) {
      const live = createLiveQueryCollection(() => query)
      read = () => live.toArray.map(({ id }) => id)
      const subscription = live.subscribeChanges(() =>
        publications.push(read()),
      )
      cleanupReceiver = async () => {
        subscription.unsubscribe()
        await live.cleanup()
      }
      await live.preload()
    } else {
      const effect = createEffect<OrderedPlanRow>({
        query: () => query,
        onBatch: (events) => {
          for (const event of events) {
            if (event.type === `exit`) effectRows.delete(event.key)
            else effectRows.set(event.key, { ...event.value })
          }
          publications.push(readEffect())
        },
      })
      cleanupReceiver = () => effect.dispose()
    }
    await flushPromises()
    const cut = (name: OrderedJoinedPlanObservation[`cut`]) => {
      check({
        cut: name,
        rows: read(),
        pending: held.filter(({ options }) => !options.signal?.aborted).length,
        publications,
      })
      publications = []
    }
    const answer = async (source?: `first` | `second`) => {
      for (let turn = 0; turn < 50; turn++) {
        const at = held.findIndex(
          (load) => source === undefined || load.source === source,
        )
        if (at < 0) return
        held.splice(at, 1)[0]!.answer()
        await flushPromises()
      }
      throw new Error(`joined plan receiver did not drain`)
    }
    cut(`initial`)
    holding = true
    rowSync.begin()
    rowSync.write({
      type: `insert`,
      value: { id: 4, rank: history.direction === `asc` ? 0 : 4 },
    })
    rowSync.commit()
    await flushPromises()
    cut(`held`)
    await answer(history.releaseFirst)
    cut(`partial`)
    holding = false
    await answer()
    await flushPromises()
    cut(`settled`)
  }, [
    async () => {
      holding = false
      for (const load of held.splice(0)) load.answer()
      await cleanupReceiver()
    },
    () => rows.cleanup(),
    () => firstSource.cleanup(),
    () => secondSource.cleanup(),
  ])
}
