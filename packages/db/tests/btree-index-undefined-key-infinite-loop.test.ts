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
 * Direct unit tests for BTreeIndex undefined value handling.
 * These test the sentinel mechanism that distinguishes between
 * "start from beginning" (no from parameter) vs "the key is literally undefined".
 */
describe(`BTreeIndex - undefined value handling`, () => {
  describe(`take vs takeFromStart`, () => {
    it(`should distinguish take(n, undefined) from takeFromStart(n)`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`value`]),
        `test_index`,
      )

      // Add items with various values including undefined
      index.add(`a`, { value: undefined })
      index.add(`b`, { value: 1 })
      index.add(`c`, { value: 2 })

      // takeFromStart should return all items from the beginning
      const fromStart = index.takeFromStart(3)
      expect(fromStart).toHaveLength(3)

      // take(n, undefined) should return items AFTER undefined
      // (since undefined is the smallest value in default comparator)
      const afterUndefined = index.take(3, undefined)
      expect(afterUndefined).toHaveLength(2)
      expect(afterUndefined).toContain(`b`)
      expect(afterUndefined).toContain(`c`)
      expect(afterUndefined).not.toContain(`a`)
    })

    it(`should distinguish takeReversed(n, undefined) from takeReversedFromEnd(n)`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`value`]),
        `test_index`,
      )

      index.add(`a`, { value: undefined })
      index.add(`b`, { value: 1 })
      index.add(`c`, { value: 2 })

      // takeReversedFromEnd should return all items from the end
      const fromEnd = index.takeReversedFromEnd(3)
      expect(fromEnd).toHaveLength(3)

      // takeReversed(n, undefined) should return items BEFORE undefined
      // Since undefined is smallest, there should be nothing before it
      const beforeUndefined = index.takeReversed(3, undefined)
      expect(beforeUndefined).toHaveLength(0)
    })
  })

  describe(`multiple undefined values`, () => {
    it(`should store and retrieve multiple items with undefined indexed values`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`priority`]),
        `test_index`,
      )

      // Add multiple items with undefined priority
      index.add(`a`, { priority: undefined })
      index.add(`b`, { priority: undefined })
      index.add(`c`, { priority: undefined })

      // All should be retrievable
      const all = index.takeFromStart(10)
      expect(all).toHaveLength(3)
      expect(all).toEqual([`a`, `b`, `c`]) // Sorted by key

      // Equality lookup should find all
      const undefinedItems = index.equalityLookup(undefined)
      expect(undefinedItems.size).toBe(3)
      expect(undefinedItems).toContain(`a`)
      expect(undefinedItems).toContain(`b`)
      expect(undefinedItems).toContain(`c`)
    })

    it(`should correctly remove items with undefined values`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`priority`]),
        `test_index`,
      )

      index.add(`a`, { priority: undefined })
      index.add(`b`, { priority: undefined })

      // Remove one
      index.remove(`a`, { priority: undefined })

      const remaining = index.equalityLookup(undefined)
      expect(remaining.size).toBe(1)
      expect(remaining).toContain(`b`)
      expect(remaining).not.toContain(`a`)
    })
  })

  describe(`ordering of undefined relative to other values`, () => {
    it(`should sort undefined before numbers with default comparator`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`value`]),
        `test_index`,
      )

      index.add(`num1`, { value: 1 })
      index.add(`undef`, { value: undefined })
      index.add(`num2`, { value: 2 })
      index.add(`num0`, { value: 0 })

      const ordered = index.orderedEntriesArray
      // undefined should come first (sorts as smallest)
      expect(ordered[0]![0]).toBe(undefined)
      expect(ordered[0]![1]).toContain(`undef`)
    })

    it(`should sort undefined before strings with default comparator`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`name`]),
        `test_index`,
      )

      index.add(`str1`, { name: `apple` })
      index.add(`undef`, { name: undefined })
      index.add(`str2`, { name: `banana` })

      const ordered = index.orderedEntriesArray
      expect(ordered[0]![0]).toBe(undefined)
    })

    it(`should handle mixed undefined and null values`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`value`]),
        `test_index`,
      )

      index.add(`null1`, { value: null })
      index.add(`undef1`, { value: undefined })
      index.add(`num1`, { value: 1 })

      // Both null and undefined should be stored separately
      const nullItems = index.equalityLookup(null)
      const undefItems = index.equalityLookup(undefined)

      expect(nullItems.size).toBe(1)
      expect(nullItems).toContain(`null1`)
      expect(undefItems.size).toBe(1)
      expect(undefItems).toContain(`undef1`)
    })
  })

  describe(`rangeQuery with undefined bounds`, () => {
    it(`should distinguish explicit undefined from vs no from`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`value`]),
        `test_index`,
      )

      index.add(`undef`, { value: undefined })
      index.add(`one`, { value: 1 })
      index.add(`two`, { value: 2 })
      index.add(`three`, { value: 3 })

      // Range with explicit from: undefined should start AT undefined
      const withExplicitFrom = index.rangeQuery({
        from: undefined,
        to: 2,
        fromInclusive: true,
        toInclusive: true,
      })
      expect(withExplicitFrom.size).toBe(3) // undefined, 1, 2
      expect(withExplicitFrom).toContain(`undef`)
      expect(withExplicitFrom).toContain(`one`)
      expect(withExplicitFrom).toContain(`two`)

      // Range without from should also start from min (which happens to be undefined)
      const withoutFrom = index.rangeQuery({
        to: 2,
        toInclusive: true,
      })
      expect(withoutFrom.size).toBe(3)
    })

    it(`should handle range query from undefined to undefined`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`value`]),
        `test_index`,
      )

      index.add(`a`, { value: undefined })
      index.add(`b`, { value: undefined })
      index.add(`c`, { value: 1 })

      // Query for just undefined values
      const justUndefined = index.rangeQuery({
        from: undefined,
        to: undefined,
        fromInclusive: true,
        toInclusive: true,
      })

      expect(justUndefined.size).toBe(2)
      expect(justUndefined).toContain(`a`)
      expect(justUndefined).toContain(`b`)
      expect(justUndefined).not.toContain(`c`)
    })
  })

  describe(`custom comparator with undefined values`, () => {
    it(`should pass actual undefined to custom comparator, not sentinel`, () => {
      const comparisons: Array<[any, any]> = []

      const customComparator = (a: any, b: any): number => {
        comparisons.push([a, b])
        // Custom logic: treat undefined as largest (opposite of default)
        if (a === undefined && b === undefined) return 0
        if (a === undefined) return 1
        if (b === undefined) return -1
        return a - b
      }

      const index = new BTreeIndex<string>(
        1,
        new PropRef([`value`]),
        `test_index`,
        { compareFn: customComparator },
      )

      index.add(`num`, { value: 1 })
      index.add(`undef`, { value: undefined })

      // Verify comparator received actual undefined, not the sentinel string
      const undefinedComparisons = comparisons.filter(
        ([a, b]) => a === undefined || b === undefined,
      )
      expect(undefinedComparisons.length).toBeGreaterThan(0)

      // With our custom comparator, undefined should sort AFTER numbers
      const ordered = index.orderedEntriesArray
      expect(ordered[0]![0]).toBe(1) // number first
      expect(ordered[1]![0]).toBe(undefined) // undefined last
    })
  })

  describe(`equalityLookup with undefined`, () => {
    it(`should find items with undefined indexed value`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`status`]),
        `test_index`,
      )

      index.add(`a`, { status: `active` })
      index.add(`b`, { status: undefined })
      index.add(`c`, { status: `inactive` })
      index.add(`d`, { status: undefined })

      const undefinedItems = index.equalityLookup(undefined)
      expect(undefinedItems.size).toBe(2)
      expect(undefinedItems).toContain(`b`)
      expect(undefinedItems).toContain(`d`)
    })

    it(`should return empty set when no undefined values exist`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`value`]),
        `test_index`,
      )

      index.add(`a`, { value: 1 })
      index.add(`b`, { value: 2 })

      const undefinedItems = index.equalityLookup(undefined)
      expect(undefinedItems.size).toBe(0)
    })
  })

  describe(`valueMapData getter`, () => {
    it(`should return undefined keys denormalized, not as sentinel`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`value`]),
        `test_index`,
      )

      index.add(`a`, { value: undefined })
      index.add(`b`, { value: 1 })

      const mapData = index.valueMapData

      // Should have undefined as an actual key, not the sentinel string
      expect(mapData.has(undefined)).toBe(true)
      expect(mapData.has(`__TS_DB_BTREE_UNDEFINED_VALUE__`)).toBe(false)

      const undefinedSet = mapData.get(undefined)
      expect(undefinedSet).toBeDefined()
      expect(undefinedSet!.has(`a`)).toBe(true)
    })
  })
})
