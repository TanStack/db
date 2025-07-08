import { beforeEach, describe, expect, it, vi } from "vitest"
import { createTransaction } from "../src/transactions"
import { createCollection } from "../src/collection"
import type { CollectionImpl } from "../src/collection"
import type { ChangeMessage, CollectionConfig } from "../src/types"

describe(`Collection getters`, () => {
  let collection: CollectionImpl
  let mockSync: {
    sync: (params: {
      collection: CollectionImpl
      begin: () => void
      write: (message: ChangeMessage) => void
      commit: () => void
    }) => void
  }
  let config: CollectionConfig

  beforeEach(() => {
    mockSync = {
      sync: vi.fn(({ begin, write, commit }) => {
        // Simulate a sync operation
        begin()
        write({
          type: `insert`,
          value: { id: `item1`, name: `Item 1` },
        })
        write({
          type: `insert`,
          value: { id: `item2`, name: `Item 2` },
        })
        commit()
      }),
    }

    config = {
      id: `test-collection`,
      getKey: (val) => val.id as string,
      sync: mockSync,
      startSync: true,
    }

    collection = createCollection(config)
  })

  describe(`state getter`, () => {
    it(`returns the current state as a Map`, () => {
      const state = collection.state
      expect(state).toBeInstanceOf(Map)
      expect(state.size).toBe(2)
      expect(state.get(`item1`)).toEqual({
        id: `item1`,
        name: `Item 1`,
      })
      expect(state.get(`item2`)).toEqual({
        id: `item2`,
        name: `Item 2`,
      })
    })
  })

  describe(`size getter`, () => {
    it(`returns the current size of the collection`, () => {
      expect(collection.size).toBe(2)
    })

    it(`returns 0 for empty collection`, () => {
      // Create a createCollection with no initial data
      const emptyCollection = createCollection({
        id: `empty-collection`,
        getKey: (val) => val.id as string,
        sync: {
          sync: ({ begin, commit }) => {
            begin()
            commit()
          },
        },
      })
      expect(emptyCollection.size).toBe(0)
    })

    it(`updates size correctly during sync operations`, () => {
      let syncCallbacks: any

      // Create a collection with controllable sync
      const syncCollection = createCollection<{ id: string; name: string }>({
        id: `sync-size-test`,
        getKey: (val) => val.id,
        startSync: true,
        sync: {
          sync: (callbacks) => {
            syncCallbacks = callbacks
            // Start with empty data
            callbacks.begin()
            callbacks.commit()
          },
        },
      })

      // Initially should be empty
      expect(syncCollection.size).toBe(0)

      // Add some items via sync
      syncCallbacks.begin()
      syncCallbacks.write({
        type: `insert`,
        value: { id: `sync1`, name: `Sync Item 1` },
      })
      syncCallbacks.write({
        type: `insert`,
        value: { id: `sync2`, name: `Sync Item 2` },
      })
      syncCallbacks.commit()

      // Size should be updated
      expect(syncCollection.size).toBe(2)

      // Delete one item via sync
      syncCallbacks.begin()
      syncCallbacks.write({
        type: `delete`,
        value: { id: `sync1`, name: `Sync Item 1` },
      })
      syncCallbacks.commit()

      // Size should be updated
      expect(syncCollection.size).toBe(1)
    })

    it(`updates size correctly with optimistic inserts`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      expect(collection.size).toBe(2)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() => collection.insert({ id: `item3`, name: `Item 3` }))

      expect(collection.size).toBe(3)
    })

    it(`updates size correctly with optimistic updates (should not change size)`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      expect(collection.size).toBe(2)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() =>
        collection.update(`item1`, (draft) => {
          draft.name = `Updated Item 1`
        })
      )

      expect(collection.size).toBe(2) // Size should remain the same for updates
    })

    it(`updates size correctly with optimistic deletes`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      expect(collection.size).toBe(2)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() => collection.delete(`item1`))

      expect(collection.size).toBe(1)
    })

    it(`updates size correctly with multiple optimistic operations`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      expect(collection.size).toBe(2)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() => {
        collection.insert({ id: `item3`, name: `Item 3` })
        collection.insert({ id: `item4`, name: `Item 4` })
        collection.delete(`item1`)
      })

      expect(collection.size).toBe(3) // 2 original - 1 deleted + 2 inserted = 3
    })
  })

  describe(`has method`, () => {
    it(`returns true for existing items`, () => {
      const key = `item1`
      expect(collection.has(key)).toBe(true)
    })

    it(`returns false for non-existing items`, () => {
      const key = `nonexistent`
      expect(collection.has(key)).toBe(false)
    })

    it(`returns true for optimistically inserted items`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() => collection.insert({ id: `item3`, name: `Item 3` }))

      const key = `item3`
      expect(collection.has(key)).toBe(true)
    })

    it(`returns false for optimistically deleted items`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() => collection.delete(`item1`))

      const key = `item1`
      expect(collection.has(key)).toBe(false)
    })

    it(`returns true for optimistically updated items`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() =>
        collection.update(`item1`, (draft) => {
          draft.name = `Updated Item 1`
        })
      )

      const key = `item1`
      expect(collection.has(key)).toBe(true)
    })
  })

  describe(`keys method`, () => {
    it(`returns all keys as an iterator`, () => {
      const keys = Array.from(collection.keys())
      expect(keys).toHaveLength(2)
      expect(keys).toContain(`item1`)
      expect(keys).toContain(`item2`)
    })

    it(`excludes optimistically deleted items`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() => collection.delete(`item1`))

      const keys = Array.from(collection.keys())
      expect(keys).toHaveLength(1)
      expect(keys).toContain(`item2`)
      expect(keys).not.toContain(`item1`)
    })

    it(`includes optimistically inserted items`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() => collection.insert({ id: `item3`, name: `Item 3` }))

      const keys = Array.from(collection.keys())
      expect(keys).toHaveLength(3)
      expect(keys).toContain(`item1`)
      expect(keys).toContain(`item2`)
      expect(keys).toContain(`item3`)
    })
  })

  describe(`values method`, () => {
    it(`returns all values as an iterator`, () => {
      const values = Array.from(collection.values())
      expect(values).toHaveLength(2)
      expect(values).toContainEqual({ id: `item1`, name: `Item 1` })
      expect(values).toContainEqual({ id: `item2`, name: `Item 2` })
    })

    it(`excludes optimistically deleted items`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() => collection.delete(`item1`))

      const values = Array.from(collection.values())
      expect(values).toHaveLength(1)
      expect(values).toContainEqual({ id: `item2`, name: `Item 2` })
      expect(values).not.toContainEqual({ id: `item1`, name: `Item 1` })
    })

    it(`includes optimistically inserted items`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() => collection.insert({ id: `item3`, name: `Item 3` }))

      const values = Array.from(collection.values())
      expect(values).toHaveLength(3)
      expect(values).toContainEqual({ id: `item1`, name: `Item 1` })
      expect(values).toContainEqual({ id: `item2`, name: `Item 2` })
      expect(values).toContainEqual({ id: `item3`, name: `Item 3` })
    })

    it(`reflects optimistic updates`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() =>
        collection.update(`item1`, (draft) => {
          draft.name = `Updated Item 1`
        })
      )

      const values = Array.from(collection.values())
      expect(values).toHaveLength(2)
      expect(values).toContainEqual({ id: `item1`, name: `Updated Item 1` })
      expect(values).toContainEqual({ id: `item2`, name: `Item 2` })
    })
  })

  describe(`entries method`, () => {
    it(`returns all entries as an iterator`, () => {
      const entries = Array.from(collection.entries())
      expect(entries).toHaveLength(2)
      expect(entries).toContainEqual([`item1`, { id: `item1`, name: `Item 1` }])
      expect(entries).toContainEqual([`item2`, { id: `item2`, name: `Item 2` }])
    })

    it(`excludes optimistically deleted items`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() => collection.delete(`item1`))

      const entries = Array.from(collection.entries())
      expect(entries).toHaveLength(1)
      expect(entries).toContainEqual([`item2`, { id: `item2`, name: `Item 2` }])
    })

    it(`includes optimistically inserted items`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() => collection.insert({ id: `item3`, name: `Item 3` }))

      const entries = Array.from(collection.entries())
      expect(entries).toHaveLength(3)
      expect(entries).toContainEqual([`item1`, { id: `item1`, name: `Item 1` }])
      expect(entries).toContainEqual([`item2`, { id: `item2`, name: `Item 2` }])
      expect(entries).toContainEqual([`item3`, { id: `item3`, name: `Item 3` }])
    })

    it(`reflects optimistic updates`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() =>
        collection.update(`item1`, (draft) => {
          draft.name = `Updated Item 1`
        })
      )

      const entries = Array.from(collection.entries())
      expect(entries).toHaveLength(2)
      expect(entries).toContainEqual([
        `item1`,
        { id: `item1`, name: `Updated Item 1` },
      ])
      expect(entries).toContainEqual([`item2`, { id: `item2`, name: `Item 2` }])
    })
  })

  describe(`get method`, () => {
    it(`returns the correct value for existing items`, () => {
      const key = `item1`
      const value = collection.get(key)
      expect(value).toEqual({ id: `item1`, name: `Item 1` })
    })

    it(`returns undefined for non-existing items`, () => {
      const key = `nonexistent`
      const value = collection.get(key)
      expect(value).toBeUndefined()
    })

    it(`returns optimistically inserted items`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() => collection.insert({ id: `item3`, name: `Item 3` }))

      const key = `item3`
      const value = collection.get(key)
      expect(value).toEqual({ id: `item3`, name: `Item 3` })
    })

    it(`returns undefined for optimistically deleted items`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() => collection.delete(`item1`))

      const key = `item1`
      const value = collection.get(key)
      expect(value).toBeUndefined()
    })

    it(`returns updated values for optimistically updated items`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)

      const tx = createTransaction({ mutationFn })
      tx.mutate(() =>
        collection.update(`item1`, (draft) => {
          draft.name = `Updated Item 1`
        })
      )

      const key = `item1`
      const value = collection.get(key)
      expect(value).toEqual({ id: `item1`, name: `Updated Item 1` })
    })
  })

  describe(`stateWhenReady`, () => {
    it(`resolves immediately if data is already available`, async () => {
      const statePromise = collection.stateWhenReady()
      const state = await statePromise
      expect(state).toBeInstanceOf(Map)
      expect(state.size).toBe(2)
    })

    it(`waits for data if not yet available`, async () => {
      // Create a createCollection with a sync that doesn't immediately commit
      let commitFn: () => void

      const delayedSyncMock = {
        sync: vi.fn(({ begin, write, commit }) => {
          // Start sync but don't commit yet
          begin()
          write({
            type: `insert`,
            value: { id: `delayed-item`, name: `Delayed Item` },
          })
          // Save the commit function for later
          commitFn = commit
        }),
      }

      const delayedCollection = createCollection({
        id: `delayed-collection`,
        getKey: (val) => val.id as string,
        startSync: true,
        sync: delayedSyncMock,
      })

      // Start the stateWhenReady promise
      const statePromise = delayedCollection.stateWhenReady()

      // Manually trigger the commit after a short delay
      setTimeout(() => {
        commitFn()
      }, 10)

      // Now the promise should resolve
      const state = await statePromise
      expect(state).toBeInstanceOf(Map)
      expect(state.get(`delayed-item`)).toEqual({
        id: `delayed-item`,
        name: `Delayed Item`,
      })
    })
  })

  describe(`toArray getter`, () => {
    it(`returns the current state as an array`, () => {
      const array = collection.toArray
      expect(Array.isArray(array)).toBe(true)
      expect(array.length).toBe(2)
      expect(array).toContainEqual({ id: `item1`, name: `Item 1` })
      expect(array).toContainEqual({ id: `item2`, name: `Item 2` })
    })
  })

  describe(`toArrayWhenReady`, () => {
    it(`resolves immediately if data is already available`, async () => {
      const arrayPromise = collection.toArrayWhenReady()
      const array = await arrayPromise
      expect(Array.isArray(array)).toBe(true)
      expect(array.length).toBe(2)
    })

    it(`waits for data if not yet available`, async () => {
      // Create a createCollection with a sync that doesn't immediately commit
      let commitFn: () => void

      const delayedSyncMock = {
        sync: vi.fn(({ begin, write, commit }) => {
          // Start sync but don't commit yet
          begin()
          write({
            type: `insert`,
            id: `delayed-item`,
            value: { id: `delayed-item`, name: `Delayed Item` },
          })
          // Save the commit function for later
          commitFn = commit
        }),
      }

      const delayedCollection = createCollection({
        id: `delayed-collection`,
        getKey: (val) => val.id as string,
        startSync: true,
        sync: delayedSyncMock,
      })

      // Start the toArrayWhenReady promise
      const arrayPromise = delayedCollection.toArrayWhenReady()

      // Manually trigger the commit after a short delay
      setTimeout(() => {
        commitFn()
      }, 10)

      // Now the promise should resolve
      const array = await arrayPromise
      expect(Array.isArray(array)).toBe(true)
      expect(array).toContainEqual({ id: `delayed-item`, name: `Delayed Item` })
    })
  })
})
