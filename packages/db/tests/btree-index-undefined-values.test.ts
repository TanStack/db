/**
 * Test for GitHub issue #1186: Infinite Loop in BTreeIndex.takeInternal
 *
 * This test reproduces the bug where using orderBy() and limit() on a collection
 * containing items with undefined indexed values causes an infinite loop.
 *
 * Root cause: When `nextHigherPair(undefined)` is called, it returns the minimum
 * pair from the B-tree. If that minimum key is itself `undefined`, the method
 * returns `[undefined, undefined]`. After processing, the code sets `key = pair[0]`
 * which is `undefined`, and calls `nextHigherPair(undefined)` again, returning
 * the same pair - creating an infinite loop.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { eq } from '../src/query/builder/functions.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { PropRef } from '../src/query/ir.js'
import { orderedEntriesArray, valueMapData } from './utils'
import type { Collection } from '../src/collection/index.js'

interface TaskItem {
  id: string
  taskDate?: Date
  assignedTo?: number | undefined
}

describe(`BTreeIndex - Issue #1186: Infinite loop with undefined indexed values`, () => {
  let collection: Collection<TaskItem, string>
  let beginFn: () => void
  let writeFn: (mutation: { type: string; value: TaskItem }) => void
  let commitFn: () => void

  beforeEach(async () => {
    collection = createCollection<TaskItem, string>({
      id: `test-collection`,
      getKey: (item) => item.id,
      defaultIndexType: BTreeIndex,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          beginFn = begin
          writeFn = write as (mutation: {
            type: string
            value: TaskItem
          }) => void
          commitFn = commit

          // Initialize with empty state
          begin()
          commit()
          markReady()
        },
      },
    })

    await collection.stateWhenReady()
  })

  // Helper function to insert items via sync
  function insertItem(item: TaskItem) {
    beginFn()
    writeFn({ type: `insert`, value: item })
    commitFn()
  }

  it(
    `should handle live query with where, orderBy and limit with undefined values`,
    { timeout: 5000 },
    async () => {
      // Create index on taskDate field
      collection.createIndex((row) => row.taskDate)
      collection.createIndex((row) => row.assignedTo)

      // Insert item with undefined assignedTo
      insertItem({ id: `1`, assignedTo: undefined, taskDate: undefined })

      // Create a live query similar to the issue report
      const liveQuery = createLiveQueryCollection({
        query: (q: any) =>
          q
            .from({ item: collection })
            .where(({ item }: any) => eq(item.assignedTo, 35))
            .orderBy(({ item }: any) => item.taskDate, `desc`)
            .limit(1)
            .select(({ item }: any) => ({
              id: item.id,
              taskDate: item.taskDate,
            })),
        startSync: true,
      })

      await liveQuery.stateWhenReady()

      // Should have 0 results (no matching assignedTo)
      expect(liveQuery.size).toBe(0)

      // Insert matching item - this should trigger the query without infinite loop
      insertItem({
        id: `2`,
        assignedTo: 35,
        taskDate: new Date(`2024-01-15`),
      })

      // Should now have 1 result
      expect(liveQuery.size).toBe(1)
      expect(liveQuery.toArray[0]?.id).toBe(`2`)
    },
  )
})

/**
 * Direct BTreeIndex tests for observations outside the direct-index oracle:
 * internal ordering and storage, custom-comparator arguments, and the public
 * live-query path above.
 */
describe(`BTreeIndex - undefined value handling`, () => {
  function createIndex(propName: string): BTreeIndex<string> {
    return new BTreeIndex<string>(1, new PropRef([propName]), `test_index`)
  }

  describe(`ordering of undefined relative to other values`, () => {
    it(`should sort undefined before numbers with default comparator`, () => {
      const index = createIndex(`value`)
      index.add(`num1`, { value: 1 })
      index.add(`undef`, { value: undefined })
      index.add(`num2`, { value: 2 })
      index.add(`num0`, { value: 0 })

      const ordered = orderedEntriesArray(index)
      expect(ordered[0]![0]).toBe(undefined)
      expect(ordered[0]![1]).toContain(`undef`)
    })

    it(`should sort undefined before strings with default comparator`, () => {
      const index = createIndex(`name`)
      index.add(`str1`, { name: `apple` })
      index.add(`undef`, { name: undefined })
      index.add(`str2`, { name: `banana` })

      expect(orderedEntriesArray(index)[0]![0]).toBe(undefined)
    })
  })

  describe(`custom comparator with undefined values`, () => {
    it(`should pass actual undefined to custom comparator, not sentinel`, () => {
      const comparisons: Array<[unknown, unknown]> = []

      function customComparator(a: unknown, b: unknown): number {
        comparisons.push([a, b])
        if (a === undefined && b === undefined) return 0
        if (a === undefined) return 1
        if (b === undefined) return -1
        return (a as number) - (b as number)
      }

      const index = new BTreeIndex<string>(
        1,
        new PropRef([`value`]),
        `test_index`,
        { compareFn: customComparator },
      )
      index.add(`num`, { value: 1 })
      index.add(`undef`, { value: undefined })

      const undefinedComparisons = comparisons.filter(
        ([a, b]) => a === undefined || b === undefined,
      )
      expect(undefinedComparisons.length).toBeGreaterThan(0)

      const ordered = orderedEntriesArray(index)
      expect(ordered[0]![0]).toBe(1)
      expect(ordered[1]![0]).toBe(undefined)
    })
  })

  describe(`valueMapData getter`, () => {
    it(`should return undefined keys denormalized, not as sentinel`, () => {
      const index = createIndex(`value`)
      index.add(`a`, { value: undefined })
      index.add(`b`, { value: 1 })

      const mapData = valueMapData(index)

      expect(mapData.has(undefined)).toBe(true)
      expect(mapData.has(`__TS_DB_BTREE_UNDEFINED_VALUE__`)).toBe(false)

      const undefinedSet = mapData.get(undefined)
      expect(undefinedSet).toBeDefined()
      expect(undefinedSet!.has(`a`)).toBe(true)
    })
  })
})
