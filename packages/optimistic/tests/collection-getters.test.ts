import { beforeEach, describe, expect, it, vi } from "vitest"
import { Collection } from "../src/collection"
import type { ChangeMessage, CollectionConfig } from "../src/types"
import "fake-indexeddb/auto"

describe(`Collection getters`, () => {
  let collection: Collection
  let mockSync: {
    sync: (params: {
      collection: Collection
      begin: () => void
      write: (message: ChangeMessage) => void
      commit: () => void
    }) => void
  }
  let mockMutationFn: { persist: () => Promise<void> }
  let config: CollectionConfig

  beforeEach(() => {
    mockSync = {
      sync: vi.fn(({ begin, write, commit }) => {
        // Simulate a sync operation
        begin()
        write({
          type: `insert`,
          key: `item1`,
          value: { id: `item1`, name: `Item 1` },
        })
        write({
          type: `insert`,
          key: `item2`,
          value: { id: `item2`, name: `Item 2` },
        })
        commit()
      }),
    }

    mockMutationFn = {
      persist: vi.fn().mockResolvedValue(undefined),
    }

    config = {
      id: `test-collection`,
      sync: mockSync,
      mutationFn: mockMutationFn,
    }

    collection = new Collection(config)
  })

  describe(`state getter`, () => {
    it(`returns the current state as a Map`, () => {
      const state = collection.state
      expect(state).toBeInstanceOf(Map)
      expect(state.size).toBe(2)
      expect(state.get(`item1`)).toEqual({ id: `item1`, name: `Item 1` })
      expect(state.get(`item2`)).toEqual({ id: `item2`, name: `Item 2` })
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
      // Create a new collection with a sync that doesn't immediately commit
      let commitFn: () => void

      const delayedSyncMock = {
        sync: vi.fn(({ begin, write, commit }) => {
          // Start sync but don't commit yet
          begin()
          write({
            type: `insert`,
            key: `delayed-item`,
            value: { id: `delayed-item`, name: `Delayed Item` },
          })
          // Save the commit function for later
          commitFn = commit
        }),
      }

      const delayedCollection = new Collection({
        id: `delayed-collection`,
        sync: delayedSyncMock,
        mutationFn: mockMutationFn,
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
      // Create a new collection with a sync that doesn't immediately commit
      let commitFn: () => void

      const delayedSyncMock = {
        sync: vi.fn(({ begin, write, commit }) => {
          // Start sync but don't commit yet
          begin()
          write({
            type: `insert`,
            key: `delayed-item`,
            value: { id: `delayed-item`, name: `Delayed Item` },
          })
          // Save the commit function for later
          commitFn = commit
        }),
      }

      const delayedCollection = new Collection({
        id: `delayed-collection`,
        sync: delayedSyncMock,
        mutationFn: mockMutationFn,
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
