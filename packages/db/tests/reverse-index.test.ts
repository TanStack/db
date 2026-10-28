/**
 * Ordinary reversal tests for indexes that have no ordered range or whose
 * reads fix one null placement, plus a live query over a range-only index.
 * The reversed-read law is owned by reverse-index-oracle.property.test.ts.
 */

import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { ReverseIndex } from '../src/indexes/reverse-index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { PropRef } from '../src/query/ir.js'
import type { IndexOperation } from '../src/indexes/base-index.js'

/** An order-capable index that advertises no equality lookup operation. */
class RangeOnlyIndex<TKey extends string | number> extends BTreeIndex<TKey> {
  public override readonly supportedOperations = new Set<IndexOperation>([
    `gt`,
    `gte`,
    `lt`,
    `lte`,
  ])

  override lookup(operation: IndexOperation, value: unknown): Set<TKey> {
    if (!this.supportedOperations.has(operation)) {
      throw new Error(`Unsupported operation: ${operation}`)
    }
    return super.lookup(operation, value)
  }
}

describe(`legacy reversed index reads`, () => {
  // An ascending index with nulls last over key 1 -> null, 2 -> 1, 3 -> 2.
  it.each([BTreeIndex, BasicIndex] as const)(
    `keeps plain reversal when no null placement is given (%o)`,
    (IndexType) => {
      const index = new IndexType<number>(
        1,
        new PropRef([`value`]),
        undefined,
        {
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
            stringSort: `locale`,
          },
        },
      )
      for (const [key, value] of [
        [1, null],
        [2, 1],
        [3, 2],
      ] as const) {
        index.add(key, { value })
      }
      const reader = new ReverseIndex(index)
      expect(reader.takeFromStart(3)).toEqual([1, 3, 2])
      expect(reader.take(3, null)).toEqual([3, 2])
    },
  )
})

describe(`reversed reads through a range-only index`, () => {
  it.each([`first`, `last`] as const)(
    `reads with nulls %s without an equality lookup`,
    (nulls) => {
      const index = new RangeOnlyIndex<number>(
        1,
        new PropRef([`value`]),
        undefined,
        { compareOptions: { direction: `asc`, nulls, stringSort: `locale` } },
      )
      for (const [key, value] of [
        [1, null],
        [2, 1],
        [3, 2],
      ] as const) {
        index.add(key, { value })
      }
      const reader = new ReverseIndex(index, nulls === `first`)
      expect(reader.takeFromStart(3)).toEqual(
        nulls === `first` ? [1, 3, 2] : [3, 2, 1],
      )
    },
  )

  it(`orders a descending snapshot and a limited live query`, async () => {
    type Item = { id: number; rank: number }
    const source = createCollection<Item, number>({
      id: `range-only-${Math.random()}`,
      getKey: (item) => item.id,
      syncMode: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 1, rank: 1 } })
          write({ type: `insert`, value: { id: 2, rank: 2 } })
          commit()
          markReady()
        },
      },
    })
    source.createIndex((item) => item.rank, { indexType: RangeOnlyIndex })
    const query = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ item: source })
          .orderBy(({ item }) => item.rank, `desc`)
          .limit(1),
    })
    try {
      const snapshot = source.currentStateAsChanges({
        orderBy: [
          {
            expression: new PropRef([`rank`]),
            compareOptions: {
              direction: `desc`,
              nulls: `first`,
              stringSort: `locale`,
            },
          },
        ],
        limit: 1,
      })
      expect(snapshot?.map((change) => change.key)).toEqual([2])
      await query.preload()
      expect(query.toArray.map((item) => item.id)).toEqual([2])
    } finally {
      await query.cleanup()
      await source.cleanup()
    }
  })
})
