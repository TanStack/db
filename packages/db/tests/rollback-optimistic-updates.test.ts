import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection'
import { createPacedMutations } from '../src/paced-mutations'
import { debounceStrategy, throttleStrategy } from '../src/strategies'
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
 * Helper to create a collection that's ready for testing.
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
  const collection = createCollection(
    mockSyncCollectionOptions<T>(opts),
  )

  const preloadPromise = collection.preload()
  await preloadPromise

  return collection
}

describe(`rollbackOptimisticUpdates`, () => {
  describe(`basic rollback`, () => {
    it(`should rollback all pending transactions when no keys are specified`, async () => {
      const collection = await createReadyCollectionWithData<Todo>({
        id: `test`,
        getKey: (item) => item.id,
        initialData: [
          { id: 1, text: `Buy milk`, revision: 1 },
          { id: 2, text: `Walk dog`, revision: 1 },
        ],
      })

      // Create optimistic updates
      collection.update(1, (draft) => {
        draft.text = `Buy almond milk`
      })
      collection.update(2, (draft) => {
        draft.text = `Walk the cat`
      })

      // Verify optimistic state
      expect(collection.get(1)?.text).toBe(`Buy almond milk`)
      expect(collection.get(2)?.text).toBe(`Walk the cat`)

      // Rollback all
      collection.rollbackOptimisticUpdates()

      // Should revert to synced data
      expect(collection.get(1)?.text).toBe(`Buy milk`)
      expect(collection.get(2)?.text).toBe(`Walk dog`)
    })

    it(`should rollback only transactions affecting specified keys`, async () => {
      const collection = await createReadyCollectionWithData<Todo>({
        id: `test`,
        getKey: (item) => item.id,
        initialData: [
          { id: 1, text: `Buy milk`, revision: 1 },
          { id: 2, text: `Walk dog`, revision: 1 },
        ],
      })

      // Create optimistic updates on different keys
      collection.update(1, (draft) => {
        draft.text = `Buy almond milk`
      })
      collection.update(2, (draft) => {
        draft.text = `Walk the cat`
      })

      // Rollback only key 1
      collection.rollbackOptimisticUpdates(1)

      // Key 1 should revert, key 2 should keep optimistic state
      expect(collection.get(1)?.text).toBe(`Buy milk`)
      expect(collection.get(2)?.text).toBe(`Walk the cat`)
    })

    it(`should rollback transactions affecting multiple specified keys`, async () => {
      const collection = await createReadyCollectionWithData<Todo>({
        id: `test`,
        getKey: (item) => item.id,
        initialData: [
          { id: 1, text: `Buy milk`, revision: 1 },
          { id: 2, text: `Walk dog`, revision: 1 },
          { id: 3, text: `Clean house`, revision: 1 },
        ],
      })

      collection.update(1, (draft) => {
        draft.text = `Updated 1`
      })
      collection.update(2, (draft) => {
        draft.text = `Updated 2`
      })
      collection.update(3, (draft) => {
        draft.text = `Updated 3`
      })

      // Rollback keys 1 and 3
      collection.rollbackOptimisticUpdates([1, 3])

      expect(collection.get(1)?.text).toBe(`Buy milk`)
      expect(collection.get(2)?.text).toBe(`Updated 2`)
      expect(collection.get(3)?.text).toBe(`Clean house`)
    })

    it(`should be a no-op when there are no pending transactions`, async () => {
      const collection = await createReadyCollectionWithData<Todo>({
        id: `test`,
        getKey: (item) => item.id,
        initialData: [{ id: 1, text: `Buy milk`, revision: 1 }],
      })

      // No pending transactions - this should not throw
      collection.rollbackOptimisticUpdates()
      collection.rollbackOptimisticUpdates(1)
      collection.rollbackOptimisticUpdates([1, 2])

      expect(collection.get(1)?.text).toBe(`Buy milk`)
    })

    it(`should be a no-op for keys that have no pending transactions`, async () => {
      const collection = await createReadyCollectionWithData<Todo>({
        id: `test`,
        getKey: (item) => item.id,
        initialData: [
          { id: 1, text: `Buy milk`, revision: 1 },
          { id: 2, text: `Walk dog`, revision: 1 },
        ],
      })

      // Only update key 1
      collection.update(1, (draft) => {
        draft.text = `Updated`
      })

      // Rollback key 2 (which has no pending transaction) - should not throw
      collection.rollbackOptimisticUpdates(2)

      // Key 1 should still have optimistic update
      expect(collection.get(1)?.text).toBe(`Updated`)
      expect(collection.get(2)?.text).toBe(`Walk dog`)
    })

    it(`should handle optimistic inserts`, async () => {
      const collection = await createReadyCollection<Todo>({
        id: `test`,
        getKey: (item) => item.id,
      })

      // Create an optimistic insert
      collection.insert({ id: 1, text: `New item`, revision: 1 })

      expect(collection.get(1)?.text).toBe(`New item`)
      expect(collection.size).toBe(1)

      // Rollback the insert
      collection.rollbackOptimisticUpdates(1)

      expect(collection.get(1)).toBeUndefined()
      expect(collection.size).toBe(0)
    })

    it(`should handle optimistic deletes`, async () => {
      const collection = await createReadyCollectionWithData<Todo>({
        id: `test`,
        getKey: (item) => item.id,
        initialData: [{ id: 1, text: `Buy milk`, revision: 1 }],
      })

      // Optimistic delete
      collection.delete(1)
      expect(collection.get(1)).toBeUndefined()

      // Rollback
      collection.rollbackOptimisticUpdates(1)

      // Item should reappear
      expect(collection.get(1)?.text).toBe(`Buy milk`)
    })
  })

  describe(`with paced mutations`, () => {
    it(`should rollback a debounced paced mutation before it commits`, async () => {
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

      // Verify optimistic state is applied
      expect(collection.get(1)?.text).toBe(`Buy almond milk`)
      expect(tx.state).toBe(`pending`)

      // Rollback before the debounce fires
      collection.rollbackOptimisticUpdates(1)

      // Optimistic state should be reverted
      expect(collection.get(1)?.text).toBe(`Buy milk`)
      expect(tx.state).toBe(`failed`)

      // Wait for the debounce period to pass
      await new Promise((resolve) => setTimeout(resolve, 150))

      // The mutationFn should NOT have been called (transaction was rolled back)
      expect(mutationFn).not.toHaveBeenCalled()

      // State should still be reverted
      expect(collection.get(1)?.text).toBe(`Buy milk`)
    })

    it(`should allow new paced mutations after rollback`, async () => {
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

      // First mutation
      mutate({ id: 1, text: `First edit` })
      expect(collection.get(1)?.text).toBe(`First edit`)

      // Rollback
      collection.rollbackOptimisticUpdates(1)
      expect(collection.get(1)?.text).toBe(`Buy milk`)

      // New mutation after rollback should work
      const tx2 = mutate({ id: 1, text: `Second edit` })
      expect(collection.get(1)?.text).toBe(`Second edit`)
      expect(tx2.state).toBe(`pending`)

      // Wait for debounce to commit the new mutation
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(mutationFn).toHaveBeenCalledTimes(1)
      expect(tx2.state).toBe(`completed`)
    })

    it(`should rollback a throttled paced mutation`, async () => {
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
        strategy: throttleStrategy({ wait: 100, leading: false, trailing: true }),
      })

      // Apply a throttled mutation
      const tx = mutate({ id: 1, text: `Throttled edit` })
      expect(collection.get(1)?.text).toBe(`Throttled edit`)

      // Rollback before the throttle fires
      collection.rollbackOptimisticUpdates(1)
      expect(collection.get(1)?.text).toBe(`Buy milk`)
      expect(tx.state).toBe(`failed`)

      // Wait for throttle period
      await new Promise((resolve) => setTimeout(resolve, 150))

      // mutationFn should NOT have been called
      expect(mutationFn).not.toHaveBeenCalled()
    })
  })

  describe(`server-side update scenario`, () => {
    it(`should allow server update to take precedence over paced mutations`, async () => {
      const mutationFn = vi.fn(async () => {})

      const collection = await createReadyCollection<Todo>({
        id: `test`,
        getKey: (item) => item.id,
      })

      // Seed initial data via sync
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: { id: 1, text: `Buy milk`, revision: 1 },
      })
      collection.utils.commit()

      expect(collection.get(1)?.text).toBe(`Buy milk`)

      // User starts editing with debounced mutations
      const mutate = createPacedMutations<{ id: number; text: string }>({
        onMutate: ({ id, text }) => {
          collection.update(id, (draft) => {
            draft.text = text
          })
        },
        mutationFn,
        strategy: debounceStrategy({ wait: 200 }),
      })

      mutate({ id: 1, text: `Buy alm` })
      mutate({ id: 1, text: `Buy almo` })
      mutate({ id: 1, text: `Buy almon` })

      // Verify optimistic state
      expect(collection.get(1)?.text).toBe(`Buy almon`)

      // Server-side update arrives (e.g., another user changed this item)
      // First, rollback the optimistic updates for this entity
      collection.rollbackOptimisticUpdates(1)

      // Then apply the server update
      collection.utils.begin()
      collection.utils.write({
        type: `update`,
        key: 1,
        value: { id: 1, text: `Buy eggs`, revision: 2 },
      })
      collection.utils.commit()

      // Server data should be visible
      expect(collection.get(1)?.text).toBe(`Buy eggs`)
      expect(collection.get(1)?.revision).toBe(2)

      // Wait for the debounce to fire (it should be a no-op)
      await new Promise((resolve) => setTimeout(resolve, 250))

      // mutationFn should NOT have been called
      expect(mutationFn).not.toHaveBeenCalled()

      // Server data should still be visible
      expect(collection.get(1)?.text).toBe(`Buy eggs`)
    })

    it(`should only affect the relevant entity, leaving other edits intact`, async () => {
      const mutationFn = vi.fn(async () => {})

      const collection = await createReadyCollection<Todo>({
        id: `test`,
        getKey: (item) => item.id,
      })

      // Seed initial data
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: { id: 1, text: `Item 1`, revision: 1 },
      })
      collection.utils.write({
        type: `insert`,
        value: { id: 2, text: `Item 2`, revision: 1 },
      })
      collection.utils.commit()

      // User edits both items with separate paced mutations
      const mutateItem1 = createPacedMutations<{ text: string }>({
        onMutate: ({ text }) => {
          collection.update(1, (draft) => {
            draft.text = text
          })
        },
        mutationFn,
        strategy: debounceStrategy({ wait: 200 }),
      })

      const mutateItem2 = createPacedMutations<{ text: string }>({
        onMutate: ({ text }) => {
          collection.update(2, (draft) => {
            draft.text = text
          })
        },
        mutationFn,
        strategy: debounceStrategy({ wait: 200 }),
      })

      mutateItem1({ text: `Editing item 1` })
      mutateItem2({ text: `Editing item 2` })

      expect(collection.get(1)?.text).toBe(`Editing item 1`)
      expect(collection.get(2)?.text).toBe(`Editing item 2`)

      // Server update arrives only for item 1
      collection.rollbackOptimisticUpdates(1)

      collection.utils.begin()
      collection.utils.write({
        type: `update`,
        key: 1,
        value: { id: 1, text: `Server updated item 1`, revision: 2 },
      })
      collection.utils.commit()

      // Item 1 should show server data, item 2 should keep optimistic state
      expect(collection.get(1)?.text).toBe(`Server updated item 1`)
      expect(collection.get(2)?.text).toBe(`Editing item 2`)
    })
  })

  describe(`edge cases`, () => {
    it(`should handle cascade rollback of related transactions`, async () => {
      const collection = await createReadyCollectionWithData<Todo>({
        id: `test`,
        getKey: (item) => item.id,
        initialData: [{ id: 1, text: `Original`, revision: 1 }],
      })

      // Create two separate updates on the same key
      collection.update(1, (draft) => {
        draft.text = `First update`
      })
      collection.update(1, (draft) => {
        draft.text = `Second update`
      })

      expect(collection.get(1)?.text).toBe(`Second update`)

      // Rolling back key 1 should cascade to all transactions on that key
      collection.rollbackOptimisticUpdates(1)

      expect(collection.get(1)?.text).toBe(`Original`)
    })

    it(`should handle rollback of transaction with mutations on multiple keys`, async () => {
      const collection = await createReadyCollection<Todo>({
        id: `test`,
        getKey: (item) => item.id,
      })

      // Seed data
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: { id: 1, text: `Item 1`, revision: 1 },
      })
      collection.utils.write({
        type: `insert`,
        value: { id: 2, text: `Item 2`, revision: 1 },
      })
      collection.utils.commit()

      // Insert a new item (single-key transaction)
      collection.insert({ id: 3, text: `Item 3`, revision: 1 })

      expect(collection.size).toBe(3)

      // Rollback only key 3
      collection.rollbackOptimisticUpdates(3)

      // Only key 3 should be removed
      expect(collection.size).toBe(2)
      expect(collection.get(1)?.text).toBe(`Item 1`)
      expect(collection.get(2)?.text).toBe(`Item 2`)
      expect(collection.get(3)).toBeUndefined()
    })
  })
})
