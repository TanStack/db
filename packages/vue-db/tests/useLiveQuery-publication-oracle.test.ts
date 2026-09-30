/**
 * Vue public-result publication law.
 *
 * Contract: One applied source change must not expose a torn `data` snapshot
 * to a synchronous Vue watcher. The source Collection has published a coherent
 * snapshot by the time its change reaches this hook. This adapter must expose
 * either the preceding result or that new result, never a transient clear.
 *
 * Model: For these identity queries, copy source rows into a plain array after
 * each sync transaction. The model uses no Vue refs or hook array mechanics.
 *
 * History grammar: start with two or three distinct rows; mount a supplied
 * Collection or an identity live query; then perform one insert, update, or
 * nonterminal delete. The empty final result, multiple source changes in one
 * transaction, and query recompilation are not covered.
 *
 * Driver and checkpoint: use the real Vue hook with a source Collection, then
 * apply one sync transaction. A `flush: 'sync'` Vue watcher records every
 * public `data` value during that transaction, before a Vue scheduler tick.
 * The refinement check rejects every value other than the old or final rows
 * and requires the final rows to appear. This also rejects an always-empty
 * adapter, which a simple "no torn value" assertion would miss.
 */
import { createCollection } from '@tanstack/db'
import { effectScope, watch } from 'vue'
import { expect, it, vi } from 'vitest'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery'

type Row = { id: string; value: number }
type Snapshot = Array<[string, number]>

const histories: ReadonlyArray<{
  name: string
  initial: Array<Row>
  change: { type: `insert` | `update` | `delete`; value: Row }
}> = [
  {
    name: `insert`,
    initial: [
      { id: `1`, value: 1 },
      { id: `2`, value: 2 },
    ],
    change: { type: `insert`, value: { id: `3`, value: 3 } },
  },
  {
    name: `update`,
    initial: [
      { id: `1`, value: 1 },
      { id: `2`, value: 2 },
    ],
    change: { type: `update`, value: { id: `1`, value: 4 } },
  },
  {
    name: `delete`,
    initial: [
      { id: `1`, value: 1 },
      { id: `2`, value: 2 },
      { id: `3`, value: 3 },
    ],
    change: { type: `delete`, value: { id: `2`, value: 2 } },
  },
]

const cases = histories.flatMap((history) =>
  ([`collection`, `query`] as const).map((input) => ({ ...history, input })),
)

function snapshot(rows: Iterable<Row>): Snapshot {
  return [...rows].map(({ id, value }) => [id, value])
}

it.each(cases)(
  `publishes one coherent Vue data snapshot for a source $name through $input`,
  async ({ name, initial, change, input }) => {
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `vue-publication-${name}-${input}`,
        getKey: (row) => row.id,
        initialData: initial,
      }),
    )
    const scope = effectScope()
    const result = scope.run(() =>
      input === `collection`
        ? useLiveQuery(source)
        : useLiveQuery((q) =>
            q.from({ items: source }).select(({ items }) => ({
              id: items.id,
              value: items.value,
            })),
          ),
    )!
    const expectedBefore = snapshot(initial)
    let primaryFailure: unknown
    try {
      await vi.waitFor(() =>
        expect(snapshot(result.data.value)).toEqual(expectedBefore),
      )

      const observed: Array<{
        publicData: Snapshot
        sourceAtCallback: Snapshot
      }> = []
      scope.run(() =>
        watch(
          () => snapshot(result.data.value),
          (publicData) => {
            observed.push({
              publicData,
              sourceAtCallback: snapshot(source.values()),
            })
          },
          { flush: `sync` },
        ),
      )

      source.utils.begin()
      source.utils.write(change)
      source.utils.commit()

      const expectedAfter = snapshot(source.values())
      expect(expectedAfter).not.toEqual(expectedBefore)
      for (const { publicData, sourceAtCallback } of observed) {
        expect(sourceAtCallback).toEqual(expectedAfter)
        expect([expectedBefore, expectedAfter]).toContainEqual(publicData)
      }
      expect(observed).toHaveLength(1)
      expect(snapshot(result.data.value)).toEqual(expectedAfter)
      expect(observed.at(-1)?.publicData).toEqual(expectedAfter)
    } catch (error) {
      primaryFailure = error
    }
    const cleanupErrors: Array<unknown> = []
    let liveQueryCollection: typeof source | null = null
    try {
      liveQueryCollection = result.collection.value as typeof source | null
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      scope.stop()
    } catch (error) {
      cleanupErrors.push(error)
    }
    if (liveQueryCollection && liveQueryCollection !== source) {
      try {
        await liveQueryCollection.cleanup()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    try {
      await source.cleanup()
    } catch (error) {
      cleanupErrors.push(error)
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        primaryFailure === undefined
          ? cleanupErrors
          : [primaryFailure, ...cleanupErrors],
        `Vue publication oracle cleanup failed`,
        { cause: primaryFailure },
      )
    }
    if (primaryFailure !== undefined) throw primaryFailure
  },
)
