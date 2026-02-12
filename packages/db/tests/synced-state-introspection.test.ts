import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection'
import { createPacedMutations } from '../src/paced-mutations'
import { debounceStrategy } from '../src/strategies'
import { deepEquals } from '../src/utils'
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
} from './utils'

type Todo = {
  id: number
  text: string
  revision: number
}

/**
 * Helper to create a collection that's ready for testing with manual sync control.
 */
async function createReadyCollection<T extends object>(opts: {
  id: string
  getKey: (item: T) => string | number
}) {
  const collection = createCollection(
    mockSyncCollectionOptionsNoInitialState<T>(opts),
  )

  const preloadPromise = collection.preload()
  collection.utils.begin()
  collection.utils.commit()
  collection.utils.markReady()
  await preloadPromise

  return collection
}

/**
 * Helper to create a collection with initial data ready for testing.
 */
async function createReadyCollectionWithData<T extends object>(opts: {
  id: string
  getKey: (item: T) => string | number
  initialData: Array<T>
}) {
  const collection = createCollection(mockSyncCollectionOptions<T>(opts))

  const preloadPromise = collection.preload()
  await preloadPromise

  return collection
}

describe(`synced state introspection`, () => {
  describe(`getSyncedValue`, () => {
    it(`should return the synced value for a key`, async () => {
      const collection = await createReadyCollectionWithData<Todo>({
        id: `test`,
        getKey: (item) => item.id,
        initialData: [{ id: 1, text: `Buy milk`, revision: 1 }],
      })

      const synced = collection.getSyncedValue(1)
      expect(synced).toEqual({ id: 1, text: `Buy milk`, revision: 1 })
    })

    it(`should return undefined for a key that does not exist in synced data`, async () => {
      const collection = await createReadyCollectionWithData<Todo>({
        id: `test`,
        getKey: (item) => item.id,
        initialData: [{ id: 1, text: `Buy milk`, revision: 1 }],
      })

      expect(collection.getSyncedValue(999)).toBeUndefined()
    })

    it(`should return the synced value even when there are optimistic updates`, async () => {
      const collection = await createReadyCollectionWithData<Todo>({
        id: `test`,
        getKey: (item) => item.id,
        initialData: [{ id: 1, text: `Buy milk`, revision: 1 }],
      })

      // Apply an optimistic update
      collection.update(1, (draft) => {
        draft.text = `Buy almond milk`
      })

      // collection.get returns the optimistic value
      expect(collection.get(1)?.text).toBe(`Buy almond milk`)

      // getSyncedValue returns the original server value
      expect(collection.getSyncedValue(1)).toEqual({
        id: 1,
        text: `Buy milk`,
        revision: 1,
      })
    })

    it(`should return undefined for optimistic-only inserts`, async () => {
      const collection = await createReadyCollection<Todo>({
        id: `test`,
        getKey: (item) => item.id,
      })

      // Insert optimistically — not yet on the server
      collection.insert({ id: 1, text: `New item`, revision: 1 })

      expect(collection.get(1)?.text).toBe(`New item`)
      expect(collection.getSyncedValue(1)).toBeUndefined()
    })

    it(`should still return the synced value when optimistically deleted`, async () => {
      const collection = await createReadyCollectionWithData<Todo>({
        id: `test`,
        getKey: (item) => item.id,
        initialData: [{ id: 1, text: `Buy milk`, revision: 1 }],
      })

      // Optimistic delete
      collection.delete(1)

      // collection.get returns undefined (optimistic view)
      expect(collection.get(1)).toBeUndefined()

      // getSyncedValue still returns the server value
      expect(collection.getSyncedValue(1)).toEqual({
        id: 1,
        text: `Buy milk`,
        revision: 1,
      })
    })

    it(`should reflect server-side updates`, async () => {
      const collection = await createReadyCollection<Todo>({
        id: `test`,
        getKey: (item) => item.id,
      })

      // Insert via sync
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: { id: 1, text: `Buy milk`, revision: 1 },
      })
      collection.utils.commit()

      expect(collection.getSyncedValue(1)).toEqual({
        id: 1,
        text: `Buy milk`,
        revision: 1,
      })

      // Server-side update arrives
      collection.utils.begin()
      collection.utils.write({
        type: `update`,
        key: 1,
        value: { id: 1, text: `Buy eggs`, revision: 2 },
      })
      collection.utils.commit()

      expect(collection.getSyncedValue(1)).toEqual({
        id: 1,
        text: `Buy eggs`,
        revision: 2,
      })
    })
  })

  describe(`getSyncedMetadata`, () => {
    it(`should return metadata set by sync operations`, async () => {
      const collection = await createReadyCollection<Todo>({
        id: `test`,
        getKey: (item) => item.id,
      })

      // Insert with metadata
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: { id: 1, text: `Buy milk`, revision: 1 },
        metadata: { etag: `abc123`, revision: 1 },
      })
      collection.utils.commit()

      const meta = collection.getSyncedMetadata(1) as Record<string, unknown>
      expect(meta).toEqual({ etag: `abc123`, revision: 1 })
    })

    it(`should return undefined for keys without metadata`, async () => {
      const collection = await createReadyCollection<Todo>({
        id: `test`,
        getKey: (item) => item.id,
      })

      expect(collection.getSyncedMetadata(999)).toBeUndefined()
    })

    it(`should merge metadata on update`, async () => {
      const collection = await createReadyCollection<Todo>({
        id: `test`,
        getKey: (item) => item.id,
      })

      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: { id: 1, text: `Buy milk`, revision: 1 },
        metadata: { etag: `abc`, revision: 1 },
      })
      collection.utils.commit()

      // Update with new metadata
      collection.utils.begin()
      collection.utils.write({
        type: `update`,
        key: 1,
        value: { id: 1, text: `Buy eggs`, revision: 2 },
        metadata: { etag: `def`, revision: 2 },
      })
      collection.utils.commit()

      const meta = collection.getSyncedMetadata(1) as Record<string, unknown>
      expect(meta).toEqual({ etag: `def`, revision: 2 })
    })
  })

  describe(`conflict detection in paced mutations`, () => {
    it(`should detect server-side change via getSyncedValue in mutationFn`, async () => {
      const persistedMutations: Array<any> = []
      const skippedConflicts: Array<any> = []

      const collection = await createReadyCollection<Todo>({
        id: `test`,
        getKey: (item) => item.id,
      })

      // Seed initial data
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: { id: 1, text: `Buy milk`, revision: 1 },
      })
      collection.utils.commit()

      const mutate = createPacedMutations<{ id: number; text: string }>({
        onMutate: ({ id, text }) => {
          collection.update(id, (draft) => {
            draft.text = text
          })
        },
        mutationFn: async ({ transaction }) => {
          // Check for conflicts before persisting
          for (const mutation of transaction.mutations) {
            const currentSynced = collection.getSyncedValue(
              mutation.key as number,
            )
            if (
              currentSynced &&
              !deepEquals(currentSynced, mutation.original)
            ) {
              // Server data changed since this mutation was created
              skippedConflicts.push({
                key: mutation.key,
                original: mutation.original,
                serverValue: currentSynced,
              })
              return // Skip persisting
            }
          }
          persistedMutations.push(transaction.mutations)
        },
        strategy: debounceStrategy({ wait: 50 }),
      })

      // User starts editing
      mutate({ id: 1, text: `Buy almond milk` })

      // Server update arrives before debounce fires
      collection.utils.begin()
      collection.utils.write({
        type: `update`,
        key: 1,
        value: { id: 1, text: `Buy eggs`, revision: 2 },
      })
      collection.utils.commit()

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 100))

      // mutationFn was called but skipped due to conflict
      expect(skippedConflicts).toHaveLength(1)
      expect(skippedConflicts[0].key).toBe(1)
      expect(persistedMutations).toHaveLength(0)
    })

    it(`should persist when no server-side conflict exists`, async () => {
      const persistedMutations: Array<any> = []

      const collection = await createReadyCollection<Todo>({
        id: `test`,
        getKey: (item) => item.id,
      })

      // Seed initial data
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: { id: 1, text: `Buy milk`, revision: 1 },
      })
      collection.utils.commit()

      const mutate = createPacedMutations<{ id: number; text: string }>({
        onMutate: ({ id, text }) => {
          collection.update(id, (draft) => {
            draft.text = text
          })
        },
        mutationFn: async ({ transaction }) => {
          for (const mutation of transaction.mutations) {
            const currentSynced = collection.getSyncedValue(
              mutation.key as number,
            )
            if (
              currentSynced &&
              !deepEquals(currentSynced, mutation.original)
            ) {
              return // Skip
            }
          }
          persistedMutations.push(transaction.mutations)
        },
        strategy: debounceStrategy({ wait: 50 }),
      })

      // User edits — no server update arrives
      mutate({ id: 1, text: `Buy almond milk` })

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should have persisted normally
      expect(persistedMutations).toHaveLength(1)
    })

    it(`should allow merge strategy when server data differs`, async () => {
      const mergedResults: Array<any> = []

      const collection = await createReadyCollection<Todo>({
        id: `test`,
        getKey: (item) => item.id,
      })

      // Seed initial data
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: { id: 1, text: `Buy milk`, revision: 1 },
      })
      collection.utils.commit()

      const mutate = createPacedMutations<{ id: number; text: string }>({
        onMutate: ({ id, text }) => {
          collection.update(id, (draft) => {
            draft.text = text
          })
        },
        mutationFn: async ({ transaction }) => {
          for (const mutation of transaction.mutations) {
            const currentSynced = collection.getSyncedValue(
              mutation.key as number,
            )
            const original = mutation.original as Todo

            if (currentSynced && currentSynced.revision !== original.revision) {
              // Server changed — merge: keep the user's text change but
              // base it on the latest server revision
              mergedResults.push({
                key: mutation.key,
                mergedValue: {
                  ...currentSynced,
                  text: (mutation.modified as Todo).text,
                },
              })
              return
            }
          }
        },
        strategy: debounceStrategy({ wait: 50 }),
      })

      // User starts editing
      mutate({ id: 1, text: `Buy almond milk` })

      // Server bumps revision with a different change
      collection.utils.begin()
      collection.utils.write({
        type: `update`,
        key: 1,
        value: { id: 1, text: `Buy eggs`, revision: 2 },
      })
      collection.utils.commit()

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should have detected conflict and merged
      expect(mergedResults).toHaveLength(1)
      expect(mergedResults[0].mergedValue).toEqual({
        id: 1,
        text: `Buy almond milk`,
        revision: 2,
      })
    })
  })

  describe(`paced mutations resilience`, () => {
    it(`should not throw when debounce fires after external transaction rollback`, async () => {
      const mutationFn = vi.fn(async () => {})

      const collection = await createReadyCollectionWithData<Todo>({
        id: `test`,
        getKey: (item) => item.id,
        initialData: [{ id: 1, text: `Buy milk`, revision: 1 }],
      })

      const mutate = createPacedMutations<{ id: number; text: string }>({
        onMutate: ({ id, text }) => {
          collection.update(id, (draft) => {
            draft.text = text
          })
        },
        mutationFn,
        strategy: debounceStrategy({ wait: 100 }),
      })

      // Apply a debounced mutation
      const tx = mutate({ id: 1, text: `Buy almond milk` })
      expect(tx.state).toBe(`pending`)

      // Externally rollback the transaction (user code or cascade)
      tx.rollback()
      expect(tx.state).toBe(`failed`)

      // Wait for the debounce period — should not throw
      await new Promise((resolve) => setTimeout(resolve, 150))

      // mutationFn should NOT have been called
      expect(mutationFn).not.toHaveBeenCalled()
    })

    it(`should create fresh transaction after external rollback`, async () => {
      const mutationFn = vi.fn(async () => {})

      const collection = await createReadyCollectionWithData<Todo>({
        id: `test`,
        getKey: (item) => item.id,
        initialData: [{ id: 1, text: `Buy milk`, revision: 1 }],
      })

      const mutate = createPacedMutations<{ id: number; text: string }>({
        onMutate: ({ id, text }) => {
          collection.update(id, (draft) => {
            draft.text = text
          })
        },
        mutationFn,
        strategy: debounceStrategy({ wait: 50 }),
      })

      // First mutation — then rollback
      const tx1 = mutate({ id: 1, text: `First edit` })
      tx1.rollback()

      // Wait for debounce to fire (no-op)
      await new Promise((resolve) => setTimeout(resolve, 70))

      // New mutation should create a fresh transaction
      const tx2 = mutate({ id: 1, text: `Second edit` })
      expect(tx2).not.toBe(tx1)
      expect(tx2.state).toBe(`pending`)

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 70))

      expect(mutationFn).toHaveBeenCalledTimes(1)
      expect(tx2.state).toBe(`completed`)
    })
  })
})
