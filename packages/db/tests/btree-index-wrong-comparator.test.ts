/**
 * Regression test for multi-column orderBy index comparator bug.
 *
 * When a query has multiple orderBy columns (e.g. `.orderBy(createdAt, 'desc').orderBy(id, 'desc')`),
 * the order-by compiler builds a multi-column comparator that expects array values:
 *   compare([createdAt, id], [createdAt, id])
 *
 * Previously, `ensureIndexForField` received this multi-column comparator to create a
 * single-column BTree index on just the first field (e.g. `createdAt`). The BTree stored
 * individual field values (numbers), but the comparator treated them as arrays — indexing
 * into a number returns `undefined`, so all values compared as equal. This collapsed the
 * BTree to a single entry, breaking `takeFromStart()` and causing live queries to return
 * 0 results for pre-existing data.
 *
 * The fix: `ensureIndexForField` now receives `makeComparator(compareOpts)` — a proper
 * single-column comparator built from the first orderBy column's compare options.
 */
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { eq } from '../src/query/builder/functions.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { PropRef } from '../src/query/ir.js'
import { DEFAULT_COMPARE_OPTIONS, makeComparator } from '../src/utils/comparison.js'
import type { Collection } from '../src/collection/index.js'

describe(`BTreeIndex multi-column comparator regression`, () => {
  it(`multi-column comparator returns NaN for single values (documents the root cause)`, () => {
    // Simulates the comparator that order-by.ts creates for multi-column orderBy
    const compiledOrderBy = [
      { compareOptions: { ...DEFAULT_COMPARE_OPTIONS, direction: `desc` as const } },
      { compareOptions: { ...DEFAULT_COMPARE_OPTIONS, direction: `desc` as const } },
    ]

    const multiColumnCompare = (a: any, b: any): number => {
      const arrayA = a as Array<unknown>
      const arrayB = b as Array<unknown>
      for (let i = 0; i < compiledOrderBy.length; i++) {
        const clause = compiledOrderBy[i]!
        const compareFn = makeComparator(clause.compareOptions)
        const result = compareFn(arrayA[i], arrayB[i])
        if (result !== 0) return result
      }
      return (arrayA as any).length - (arrayB as any).length
    }

    // When called with single numbers (not arrays), number[i] is undefined.
    // Comparing undefined vs undefined yields 0, then the length subtraction
    // (number.length is undefined) produces NaN.
    const result = multiColumnCompare(1735689639000, 1735689638000)
    expect(result).toBeNaN()
  })

  it(`BTreeIndex with single-column comparator works correctly`, () => {
    // This is what ensureIndexForField should pass after the fix
    const singleColumnCompare = makeComparator({
      ...DEFAULT_COMPARE_OPTIONS,
      direction: `desc`,
    })

    const index = new BTreeIndex(
      1,
      new PropRef([`createdAt`]),
      `test-createdAt`,
      { compareFn: singleColumnCompare },
    )

    for (let i = 0; i < 26; i++) {
      index.add(`item-${i}` as any, { createdAt: 1735689600000 + i * 1000 })
    }

    expect(index.keyCount).toBe(26)
    expect(index.takeFromStart(30, () => true).length).toBe(26)
  })

  it(`live query with multi-column orderBy sees all items after thread switch`, async () => {
    interface Msg {
      id: string
      threadId: string
      createdAt: number
    }

    let beginFn: () => void
    let writeFn: (msg: { type: string; value: Msg }) => void
    let commitFn: () => void

    const collection: Collection<Msg, string> = createCollection<Msg, string>({
      id: `messages`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          beginFn = begin
          writeFn = write as any
          commitFn = commit
          begin()
          commit()
          markReady()
        },
      },
    })

    await collection.stateWhenReady()

    const thread1 = Array.from({ length: 26 }, (_, i) => ({
      id: `t1-${i}`,
      threadId: `t1`,
      createdAt: 1735689600000 + i * 1000,
    }))
    const thread2 = Array.from({ length: 6 }, (_, i) => ({
      id: `t2-${i}`,
      threadId: `t2`,
      createdAt: 1735689700000 + i * 1000,
    }))

    // Insert both threads
    beginFn!()
    for (const msg of [...thread1, ...thread2]) {
      writeFn!({ type: `insert`, value: msg })
    }
    commitFn!()
    expect(collection.size).toBe(32)

    // Create live query with multi-column orderBy + limit (like useLiveInfiniteQuery does)
    const liveQuery = createLiveQueryCollection({
      query: (q: any) =>
        q
          .from({ msg: collection })
          .where(({ msg }: any) => eq(msg.threadId, `t2`))
          .orderBy(({ msg }: any) => msg.createdAt, `desc`)
          .orderBy(({ msg }: any) => msg.id, `desc`)
          .limit(30),
    })

    await liveQuery.preload()
    const results = Array.from(liveQuery)
    expect(results.length).toBe(6)
  })
})
