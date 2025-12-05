import { describe, expect, it } from 'vitest'
import { SortedMap } from '../src/SortedMap'
import { BTreeIndex } from '../src/indexes/btree-index'
import { createCollection } from '../src/collection/index.js'
import { PropRef } from '../src/query/ir'
import { mockSyncCollectionOptions } from './utils'

/**
 * These tests verify deterministic ordering behavior when values compare as equal.
 *
 * The issue: When multiple items have the same "sort value" (e.g., same priority),
 * their relative ordering should be deterministic and stable based on their key.
 * Without key-based tie-breaking, the order depends on insertion order, which
 * can vary between page loads, sync operations, etc.
 */

describe(`Deterministic Ordering`, () => {
  describe(`SortedMap`, () => {
    it(`should maintain deterministic order when values are equal`, () => {
      // All values are the same (priority = 1), so they compare as equal
      const map = new SortedMap<string, { priority: number }>(
        (a, b) => a.priority - b.priority,
      )

      // Insert in "random" order
      map.set(`c`, { priority: 1 })
      map.set(`a`, { priority: 1 })
      map.set(`b`, { priority: 1 })

      // With key-based tie-breaking, should always iterate in key order: a, b, c
      const keys = Array.from(map.keys())
      expect(keys).toEqual([`a`, `b`, `c`])
    })

    it(`should maintain deterministic order with mixed equal and different values`, () => {
      const map = new SortedMap<string, { priority: number }>(
        (a, b) => a.priority - b.priority,
      )

      // Mix of equal and different priorities
      map.set(`d`, { priority: 2 })
      map.set(`c`, { priority: 1 })
      map.set(`a`, { priority: 1 })
      map.set(`e`, { priority: 2 })
      map.set(`b`, { priority: 1 })

      // Expected: priority 1 items (a, b, c) sorted by key, then priority 2 items (d, e) sorted by key
      const keys = Array.from(map.keys())
      expect(keys).toEqual([`a`, `b`, `c`, `d`, `e`])
    })

    it(`should maintain deterministic order with numeric keys`, () => {
      const map = new SortedMap<number, { priority: number }>(
        (a, b) => a.priority - b.priority,
      )

      map.set(30, { priority: 1 })
      map.set(10, { priority: 1 })
      map.set(20, { priority: 1 })

      const keys = Array.from(map.keys())
      expect(keys).toEqual([10, 20, 30])
    })

    it(`should maintain deterministic order after updates`, () => {
      const map = new SortedMap<string, { priority: number }>(
        (a, b) => a.priority - b.priority,
      )

      map.set(`c`, { priority: 1 })
      map.set(`a`, { priority: 1 })
      map.set(`b`, { priority: 1 })

      // Update 'b' with same priority
      map.set(`b`, { priority: 1 })

      const keys = Array.from(map.keys())
      expect(keys).toEqual([`a`, `b`, `c`])
    })

    it(`should maintain deterministic order after delete and re-insert`, () => {
      const map = new SortedMap<string, { priority: number }>(
        (a, b) => a.priority - b.priority,
      )

      map.set(`c`, { priority: 1 })
      map.set(`a`, { priority: 1 })
      map.set(`b`, { priority: 1 })

      map.delete(`b`)
      map.set(`b`, { priority: 1 })

      const keys = Array.from(map.keys())
      expect(keys).toEqual([`a`, `b`, `c`])
    })

    it(`should use key as tie-breaker even without custom comparator`, () => {
      // When no comparator is provided, all items have "equal" sort value (default behavior)
      // They should still be ordered by key
      const map = new SortedMap<string, { name: string }>()

      map.set(`c`, { name: `Charlie` })
      map.set(`a`, { name: `Alice` })
      map.set(`b`, { name: `Bob` })

      const keys = Array.from(map.keys())
      expect(keys).toEqual([`a`, `b`, `c`])
    })
  })

  describe(`BTreeIndex`, () => {
    it(`should return keys in deterministic order when indexed values are equal`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`priority`]),
        `priority_index`,
      )

      // All have same priority
      index.add(`c`, { priority: 1 })
      index.add(`a`, { priority: 1 })
      index.add(`b`, { priority: 1 })

      // take() should return keys in key-sorted order when priorities are equal
      const keys = index.take(3)
      expect(keys).toEqual([`a`, `b`, `c`])
    })

    it(`should return keys in deterministic order with mixed equal and different values`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`priority`]),
        `priority_index`,
      )

      index.add(`d`, { priority: 2 })
      index.add(`c`, { priority: 1 })
      index.add(`a`, { priority: 1 })
      index.add(`e`, { priority: 2 })
      index.add(`b`, { priority: 1 })

      // take() should return priority 1 keys sorted by key, then priority 2 keys sorted by key
      const keys = index.take(5)
      expect(keys).toEqual([`a`, `b`, `c`, `d`, `e`])
    })

    it(`should return keys in deterministic order with numeric keys`, () => {
      const index = new BTreeIndex<number>(
        1,
        new PropRef([`priority`]),
        `priority_index`,
      )

      index.add(30, { priority: 1 })
      index.add(10, { priority: 1 })
      index.add(20, { priority: 1 })

      const keys = index.take(3)
      expect(keys).toEqual([10, 20, 30])
    })

    it(`should return keys in deterministic order for takeReversed`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`priority`]),
        `priority_index`,
      )

      index.add(`c`, { priority: 1 })
      index.add(`a`, { priority: 1 })
      index.add(`b`, { priority: 1 })

      // takeReversed should return keys in reverse key order when priorities are equal
      const keys = index.takeReversed(3)
      expect(keys).toEqual([`c`, `b`, `a`])
    })

    it(`should maintain deterministic order after remove and re-add`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`priority`]),
        `priority_index`,
      )

      index.add(`c`, { priority: 1 })
      index.add(`a`, { priority: 1 })
      index.add(`b`, { priority: 1 })

      index.remove(`b`, { priority: 1 })
      index.add(`b`, { priority: 1 })

      const keys = index.take(3)
      expect(keys).toEqual([`a`, `b`, `c`])
    })

    it(`should return keys in deterministic order with take from cursor across different values`, () => {
      const index = new BTreeIndex<string>(
        1,
        new PropRef([`priority`]),
        `priority_index`,
      )

      // Add keys with different priorities
      index.add(`e`, { priority: 2 })
      index.add(`c`, { priority: 1 })
      index.add(`a`, { priority: 1 })
      index.add(`f`, { priority: 2 })
      index.add(`d`, { priority: 2 })
      index.add(`b`, { priority: 1 })

      // First batch - should get priority 1 keys in key order
      const firstBatch = index.take(3)
      expect(firstBatch).toEqual([`a`, `b`, `c`])

      // Continue from cursor value 1 (exclusive) - should get priority 2 keys in key order
      const secondBatch = index.take(3, 1)
      expect(secondBatch).toEqual([`d`, `e`, `f`])
    })
  })

  describe(`Collection iteration`, () => {
    it(`should iterate in deterministic order when compare function returns equal`, () => {
      type Item = { id: string; priority: number }

      const options = mockSyncCollectionOptions<Item>({
        id: `test-collection`,
        getKey: (item) => item.id,
        initialData: [],
      })

      const collection = createCollection({
        ...options,
        // Compare by priority only - items with same priority compare as equal
        compare: (a, b) => a.priority - b.priority,
      })

      // Insert via sync in "random" order
      options.utils.begin()
      options.utils.write({ type: `insert`, value: { id: `c`, priority: 1 } })
      options.utils.write({ type: `insert`, value: { id: `a`, priority: 1 } })
      options.utils.write({ type: `insert`, value: { id: `b`, priority: 1 } })
      options.utils.commit()

      // Should iterate in key order when priorities are equal
      const keys = [...collection.keys()]
      expect(keys).toEqual([`a`, `b`, `c`])
    })

    it(`should iterate in deterministic order with mixed priorities`, () => {
      type Item = { id: string; priority: number }

      const options = mockSyncCollectionOptions<Item>({
        id: `test-collection-mixed`,
        getKey: (item) => item.id,
        initialData: [],
      })

      const collection = createCollection({
        ...options,
        compare: (a, b) => a.priority - b.priority,
      })

      options.utils.begin()
      options.utils.write({ type: `insert`, value: { id: `d`, priority: 2 } })
      options.utils.write({ type: `insert`, value: { id: `c`, priority: 1 } })
      options.utils.write({ type: `insert`, value: { id: `a`, priority: 1 } })
      options.utils.write({ type: `insert`, value: { id: `e`, priority: 2 } })
      options.utils.write({ type: `insert`, value: { id: `b`, priority: 1 } })
      options.utils.commit()

      // Priority 1 items sorted by key, then priority 2 items sorted by key
      const keys = [...collection.keys()]
      expect(keys).toEqual([`a`, `b`, `c`, `d`, `e`])
    })

    it(`should maintain deterministic order after incremental sync`, () => {
      type Item = { id: string; priority: number }

      const options = mockSyncCollectionOptions<Item>({
        id: `test-collection-incremental`,
        getKey: (item) => item.id,
        initialData: [],
      })

      const collection = createCollection({
        ...options,
        compare: (a, b) => a.priority - b.priority,
      })

      // First sync batch
      options.utils.begin()
      options.utils.write({ type: `insert`, value: { id: `c`, priority: 1 } })
      options.utils.write({ type: `insert`, value: { id: `a`, priority: 1 } })
      options.utils.commit()

      // Second sync batch (simulating incremental load)
      options.utils.begin()
      options.utils.write({ type: `insert`, value: { id: `b`, priority: 1 } })
      options.utils.commit()

      // Order should be deterministic regardless of sync batch order
      const keys = [...collection.keys()]
      expect(keys).toEqual([`a`, `b`, `c`])
    })

    it(`should maintain deterministic order when collection has no compare function`, () => {
      // Even without a compare function, iteration order should be deterministic (by key)
      type Item = { id: string; name: string }

      const options = mockSyncCollectionOptions<Item>({
        id: `test-collection-no-compare`,
        getKey: (item) => item.id,
        initialData: [],
      })

      const collection = createCollection(options)

      options.utils.begin()
      options.utils.write({
        type: `insert`,
        value: { id: `c`, name: `Charlie` },
      })
      options.utils.write({ type: `insert`, value: { id: `a`, name: `Alice` } })
      options.utils.write({ type: `insert`, value: { id: `b`, name: `Bob` } })
      options.utils.commit()

      // Without compare function, should still iterate in key order
      const keys = [...collection.keys()]
      expect(keys).toEqual([`a`, `b`, `c`])
    })
  })

  describe(`Collection currentStateAsChanges with orderBy`, () => {
    it(`should return changes in deterministic order when orderBy values are equal`, () => {
      type Item = { id: string; priority: number }

      const options = mockSyncCollectionOptions<Item>({
        id: `test-collection-changes`,
        getKey: (item) => item.id,
        initialData: [],
      })

      const collection = createCollection(options)

      options.utils.begin()
      options.utils.write({ type: `insert`, value: { id: `c`, priority: 1 } })
      options.utils.write({ type: `insert`, value: { id: `a`, priority: 1 } })
      options.utils.write({ type: `insert`, value: { id: `b`, priority: 1 } })
      options.utils.commit()

      const changes = collection.currentStateAsChanges({
        orderBy: [
          {
            expression: new PropRef([`priority`]),
            compareOptions: { direction: `asc`, nulls: `last` },
          },
        ],
      })

      const keys = changes?.map((c) => c.key)
      expect(keys).toEqual([`a`, `b`, `c`])
    })

    it(`should return changes in deterministic order with limit`, () => {
      type Item = { id: string; priority: number }

      const options = mockSyncCollectionOptions<Item>({
        id: `test-collection-changes-limit`,
        getKey: (item) => item.id,
        initialData: [],
      })

      const collection = createCollection(options)

      options.utils.begin()
      options.utils.write({ type: `insert`, value: { id: `e`, priority: 1 } })
      options.utils.write({ type: `insert`, value: { id: `c`, priority: 1 } })
      options.utils.write({ type: `insert`, value: { id: `a`, priority: 1 } })
      options.utils.write({ type: `insert`, value: { id: `d`, priority: 1 } })
      options.utils.write({ type: `insert`, value: { id: `b`, priority: 1 } })
      options.utils.commit()

      const changes = collection.currentStateAsChanges({
        orderBy: [
          {
            expression: new PropRef([`priority`]),
            compareOptions: { direction: `asc`, nulls: `last` },
          },
        ],
        limit: 3,
      })

      // First 3 in key order: a, b, c
      const keys = changes?.map((c) => c.key)
      expect(keys).toEqual([`a`, `b`, `c`])
    })
  })
})
