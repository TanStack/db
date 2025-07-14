import { beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "../src/index"
import { localOnlyCollectionOptions } from "../src/local-only"
import type { LocalOnlyCollectionUtils } from "../src/local-only"
import type { Collection } from "../src/index"

interface TestItem extends Record<string, unknown> {
  id: number
  name: string
  completed?: boolean
}

describe(`LocalOnly Collection`, () => {
  let collection: Collection<TestItem, number, LocalOnlyCollectionUtils>

  beforeEach(() => {
    // Create collection with LocalOnly configuration
    collection = createCollection<TestItem, number>(
      localOnlyCollectionOptions({
        id: `test-local-only`,
        getKey: (item: TestItem) => item.id,
      })
    )
  })

  it(`should create an empty collection initially`, () => {
    expect(collection.state).toEqual(new Map())
    expect(collection.size).toBe(0)
  })

  it(`should handle insert operations optimistically`, () => {
    // Insert an item
    collection.insert({ id: 1, name: `Test Item` })

    // The item should be immediately available in the collection
    expect(collection.has(1)).toBe(true)
    expect(collection.get(1)).toEqual({ id: 1, name: `Test Item` })
    expect(collection.size).toBe(1)
  })

  it(`should handle multiple inserts`, () => {
    // Insert multiple items
    collection.insert([
      { id: 1, name: `Item 1` },
      { id: 2, name: `Item 2` },
      { id: 3, name: `Item 3` },
    ])

    // All items should be immediately available
    expect(collection.size).toBe(3)
    expect(collection.get(1)).toEqual({ id: 1, name: `Item 1` })
    expect(collection.get(2)).toEqual({ id: 2, name: `Item 2` })
    expect(collection.get(3)).toEqual({ id: 3, name: `Item 3` })
  })

  it(`should handle update operations optimistically`, () => {
    // Insert an item first
    collection.insert({ id: 1, name: `Original Item` })

    // Update the item
    collection.update(1, (draft) => {
      draft.name = `Updated Item`
      draft.completed = true
    })

    // The update should be immediately reflected
    expect(collection.get(1)).toEqual({
      id: 1,
      name: `Updated Item`,
      completed: true,
    })
  })

  it(`should handle delete operations optimistically`, () => {
    // Insert items first
    collection.insert([
      { id: 1, name: `Item 1` },
      { id: 2, name: `Item 2` },
    ])

    expect(collection.size).toBe(2)

    // Delete one item
    collection.delete(1)

    // The item should be immediately removed
    expect(collection.has(1)).toBe(false)
    expect(collection.has(2)).toBe(true)
    expect(collection.size).toBe(1)
  })

  it(`should handle mixed operations`, () => {
    // Perform a series of mixed operations
    collection.insert({ id: 1, name: `Item 1` })
    collection.insert({ id: 2, name: `Item 2` })

    expect(collection.size).toBe(2)

    // Update item 1
    collection.update(1, (draft) => {
      draft.completed = true
    })

    // Delete item 2
    collection.delete(2)

    // Insert item 3
    collection.insert({ id: 3, name: `Item 3` })

    // Check final state
    expect(collection.size).toBe(2)
    expect(collection.get(1)).toEqual({
      id: 1,
      name: `Item 1`,
      completed: true,
    })
    expect(collection.has(2)).toBe(false)
    expect(collection.get(3)).toEqual({ id: 3, name: `Item 3` })
  })

  it(`should support change subscriptions`, () => {
    const changeHandler = vi.fn()

    // Subscribe to changes
    const unsubscribe = collection.subscribeChanges(changeHandler)

    // Insert an item
    collection.insert({ id: 1, name: `Test Item` })

    // The change handler should have been called
    expect(changeHandler).toHaveBeenCalledTimes(1)
    expect(changeHandler).toHaveBeenCalledWith([
      {
        type: `insert`,
        key: 1,
        value: { id: 1, name: `Test Item` },
      },
    ])

    // Clean up
    unsubscribe()
  })

  it(`should support toArray method`, () => {
    // Insert some items
    collection.insert([
      { id: 3, name: `Item 3` },
      { id: 1, name: `Item 1` },
      { id: 2, name: `Item 2` },
    ])

    const array = collection.toArray

    // Should contain all items
    expect(array).toHaveLength(3)
    expect(array).toEqual(
      expect.arrayContaining([
        { id: 1, name: `Item 1` },
        { id: 2, name: `Item 2` },
        { id: 3, name: `Item 3` },
      ])
    )
  })

  it(`should support entries and iteration`, () => {
    // Insert some items
    collection.insert([
      { id: 1, name: `Item 1` },
      { id: 2, name: `Item 2` },
    ])

    // Test entries
    const entries = Array.from(collection.entries())
    expect(entries).toHaveLength(2)
    expect(entries).toEqual(
      expect.arrayContaining([
        [1, { id: 1, name: `Item 1` }],
        [2, { id: 2, name: `Item 2` }],
      ])
    )

    // Test values iteration
    const items = []
    for (const item of collection.values()) {
      items.push(item)
    }
    expect(items).toHaveLength(2)
  })

  describe(`Pure optimistic behavior`, () => {
    it(`should handle insert operations optimistically`, () => {
      // Insert an item - this works purely optimistically
      collection.insert({ id: 1, name: `Test Item` })

      // The item should be available in the collection
      expect(collection.has(1)).toBe(true)
      expect(collection.get(1)).toEqual({ id: 1, name: `Test Item` })
    })

    it(`should handle update operations optimistically`, () => {
      // Insert an item first
      collection.insert({ id: 1, name: `Test Item` })

      // Update the item - this works purely optimistically
      collection.update(1, (draft) => {
        draft.name = `Updated Item`
      })

      // The update should be reflected in the collection
      expect(collection.get(1)).toEqual({ id: 1, name: `Updated Item` })
    })

    it(`should handle delete operations optimistically`, () => {
      // Insert an item first
      collection.insert({ id: 1, name: `Test Item` })
      expect(collection.has(1)).toBe(true)

      // Delete the item - this works purely optimistically
      collection.delete(1)

      // The item should be removed from the collection
      expect(collection.has(1)).toBe(false)
    })
  })

  describe(`Schema support`, () => {
    it(`should work with schema configuration`, () => {
      // This tests that the type system works correctly with schemas
      // In a real implementation, you would provide a schema for validation
      const testCollection = createCollection(
        localOnlyCollectionOptions({
          id: `test-schema`,
          getKey: (item: TestItem) => item.id,
        })
      )

      // Basic operations should still work
      testCollection.insert({ id: 1, name: `Test with Schema` })
      expect(testCollection.get(1)).toEqual({ id: 1, name: `Test with Schema` })
    })
  })

  describe(`Utils object`, () => {
    it(`should expose utils object (even if empty)`, () => {
      expect(collection.utils).toBeDefined()
      expect(typeof collection.utils).toBe(`object`)
    })
  })

  describe(`Custom callbacks`, () => {
    it(`should call custom onInsert callback when provided`, () => {
      const onInsertSpy = vi.fn()

      const testCollection = createCollection(
        localOnlyCollectionOptions({
          id: `test-custom-callbacks`,
          getKey: (item: TestItem) => item.id,
          onInsert: onInsertSpy,
        })
      )

      testCollection.insert({ id: 1, name: `Test Item` })

      expect(onInsertSpy).toHaveBeenCalledTimes(1)
      expect(onInsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({
            mutations: expect.arrayContaining([
              expect.objectContaining({
                type: `insert`,
                modified: { id: 1, name: `Test Item` },
              }),
            ]),
          }),
        })
      )

      // Collection should still work normally
      expect(testCollection.get(1)).toEqual({ id: 1, name: `Test Item` })
    })

    it(`should call custom onUpdate callback when provided`, () => {
      const onUpdateSpy = vi.fn()

      const testCollection = createCollection(
        localOnlyCollectionOptions({
          id: `test-custom-update`,
          getKey: (item: TestItem) => item.id,
          onUpdate: onUpdateSpy,
        })
      )

      testCollection.insert({ id: 1, name: `Test Item` })
      testCollection.update(1, (draft) => {
        draft.name = `Updated Item`
      })

      expect(onUpdateSpy).toHaveBeenCalledTimes(1)
      expect(onUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({
            mutations: expect.arrayContaining([
              expect.objectContaining({
                type: `update`,
                modified: { id: 1, name: `Updated Item` },
              }),
            ]),
          }),
        })
      )

      // Collection should still work normally
      expect(testCollection.get(1)).toEqual({ id: 1, name: `Updated Item` })
    })

    it(`should call custom onDelete callback when provided`, () => {
      const onDeleteSpy = vi.fn()

      const testCollection = createCollection(
        localOnlyCollectionOptions({
          id: `test-custom-delete`,
          getKey: (item: TestItem) => item.id,
          onDelete: onDeleteSpy,
        })
      )

      testCollection.insert({ id: 1, name: `Test Item` })
      testCollection.delete(1)

      expect(onDeleteSpy).toHaveBeenCalledTimes(1)
      expect(onDeleteSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({
            mutations: expect.arrayContaining([
              expect.objectContaining({
                type: `delete`,
                original: { id: 1, name: `Test Item` },
              }),
            ]),
          }),
        })
      )

      // Collection should still work normally
      expect(testCollection.has(1)).toBe(false)
    })

    it(`should work without custom callbacks`, () => {
      const testCollection = createCollection(
        localOnlyCollectionOptions({
          id: `test-no-callbacks`,
          getKey: (item: TestItem) => item.id,
        })
      )

      // Should work normally without callbacks
      testCollection.insert({ id: 1, name: `Test Item` })
      testCollection.update(1, (draft) => {
        draft.name = `Updated Item`
      })
      testCollection.delete(1)

      expect(testCollection.has(1)).toBe(false)
    })
  })

  describe(`Initial data`, () => {
    it(`should populate collection with initial data on creation`, () => {
      const initialItems: Array<TestItem> = [
        { id: 10, name: `Initial Item 1` },
        { id: 20, name: `Initial Item 2` },
        { id: 30, name: `Initial Item 3` },
      ]

      const testCollection = createCollection(
        localOnlyCollectionOptions({
          id: `test-initial-data`,
          getKey: (item: TestItem) => item.id,
          initialData: initialItems,
        })
      )

      // Collection should be populated with initial data
      expect(testCollection.size).toBe(3)
      expect(testCollection.get(10)).toEqual({ id: 10, name: `Initial Item 1` })
      expect(testCollection.get(20)).toEqual({ id: 20, name: `Initial Item 2` })
      expect(testCollection.get(30)).toEqual({ id: 30, name: `Initial Item 3` })
    })

    it(`should work with empty initial data array`, () => {
      const testCollection = createCollection(
        localOnlyCollectionOptions({
          id: `test-empty-initial-data`,
          getKey: (item: TestItem) => item.id,
          initialData: [],
        })
      )

      // Collection should be empty
      expect(testCollection.size).toBe(0)
    })

    it(`should work without initial data property`, () => {
      const testCollection = createCollection(
        localOnlyCollectionOptions({
          id: `test-no-initial-data`,
          getKey: (item: TestItem) => item.id,
        })
      )

      // Collection should be empty
      expect(testCollection.size).toBe(0)
    })

    it(`should allow adding more items after initial data`, () => {
      const initialItems: Array<TestItem> = [{ id: 100, name: `Initial Item` }]

      const testCollection = createCollection<TestItem, number>(
        localOnlyCollectionOptions({
          id: `test-initial-plus-more`,
          getKey: (item: TestItem) => item.id,
          initialData: initialItems,
        })
      )

      // Should start with initial data
      expect(testCollection.size).toBe(1)
      expect(testCollection.get(100)).toEqual({ id: 100, name: `Initial Item` })

      // Should be able to add more items
      testCollection.insert({ id: 200, name: `Added Item` })

      expect(testCollection.size).toBe(2)
      expect(testCollection.get(100)).toEqual({ id: 100, name: `Initial Item` })
      expect(testCollection.get(200)).toEqual({ id: 200, name: `Added Item` })
    })
  })
})
