import { beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "../src/collection"
import type { Collection } from "../src/collection"
import type { ChangeMessage, CollectionConfig } from "../src/types"

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
      getId: (val) => val.id,
      sync: mockSync,
    }

    collection = createCollection(config)
  })

  describe(`state getter`, () => {
    it(`returns the current state as a Map`, () => {
      const state = collection.state
      expect(state).toBeInstanceOf(Map)
      expect(state.size).toBe(2)
      expect(state.get(`KEY::${collection.id}/item1`)).toEqual({
        id: `item1`,
        name: `Item 1`,
      })
      expect(state.get(`KEY::${collection.id}/item2`)).toEqual({
        id: `item2`,
        name: `Item 2`,
      })
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
            value: { id: `delayed-item`, name: `Delayed Item` },
          })
          // Save the commit function for later
          commitFn = commit
        }),
      }

      const delayedCollection = createCollection({
        id: `delayed-collection`,
        getId: (val) => val.id,
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
      expect(state.get(`KEY::${delayedCollection.id}/delayed-item`)).toEqual({
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
            id: `delayed-item`,
            value: { id: `delayed-item`, name: `Delayed Item` },
          })
          // Save the commit function for later
          commitFn = commit
        }),
      }

      const delayedCollection = createCollection({
        id: `delayed-collection`,
        getId: (val) => val.id,
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
