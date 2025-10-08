import { beforeEach, describe, expect, it, vi } from "vitest"
import { createTransaction } from "../src/transactions"
import { createCollection } from "../src/collection/index.js"
import type { CollectionImpl } from "../src/collection/index.js"
import type { SyncConfig } from "../src/types"

type Item = { id: string; name: string; count?: number }

describe(`Collection getOptimisticInfo`, () => {
  let collection: CollectionImpl<Item>
  let mockSync: SyncConfig<Item>

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

    const config = {
      id: `test-collection`,
      getKey: (val: Item) => val.id,
      sync: mockSync,
      startSync: true,
    }

    collection = createCollection(config)
  })

  describe(`non-optimistic records`, () => {
    it(`returns undefined for non-existent key`, () => {
      const info = collection.getOptimisticInfo(`nonexistent`)
      expect(info).toBeUndefined()
    })

    it(`returns isOptimistic: false for synced records`, () => {
      const info = collection.getOptimisticInfo(`item1`)
      expect(info).toBeDefined()
      expect(info?.isOptimistic).toBe(false)
      expect(info?.modified).toEqual({ id: `item1`, name: `Item 1` })
      expect(info?.original).toBeUndefined()
      expect(info?.changes).toBeUndefined()
      expect(info?.mutations).toHaveLength(0)
    })
  })

  describe(`optimistic insert`, () => {
    it(`returns optimistic info for optimistically inserted record`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)
      const tx = createTransaction({ mutationFn })

      tx.mutate(() => {
        collection.insert({ id: `item3`, name: `Item 3` })
      })

      const info = collection.getOptimisticInfo(`item3`)
      expect(info).toBeDefined()
      expect(info?.isOptimistic).toBe(true)
      expect(info?.modified).toEqual({ id: `item3`, name: `Item 3` })
      expect(info?.original).toBeUndefined() // No original for insert
      expect(info?.changes).toBeUndefined() // No changes for insert
      expect(info?.mutations).toHaveLength(1)
      expect(info?.mutations[0]?.type).toBe(`insert`)
    })

    it(`removes optimistic state after transaction completes`, async () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)
      const tx = createTransaction({ mutationFn })

      tx.mutate(() => {
        collection.insert({ id: `item3`, name: `Item 3` })
      })

      // Before commit
      expect(collection.getOptimisticInfo(`item3`)?.isOptimistic).toBe(true)

      // Wait for transaction to complete (auto-commits)
      await tx.isPersisted.promise

      // After commit, optimistic state is removed
      // Note: Without sync adding the record, it no longer exists
      const info = collection.getOptimisticInfo(`item3`)
      expect(info).toBeUndefined()
    })
  })

  describe(`optimistic update`, () => {
    it(`returns optimistic info for optimistically updated record`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)
      const tx = createTransaction({ mutationFn })

      tx.mutate(() => {
        collection.update(`item1`, (draft) => {
          draft.name = `Updated Item 1`
        })
      })

      const info = collection.getOptimisticInfo(`item1`)
      expect(info).toBeDefined()
      expect(info?.isOptimistic).toBe(true)
      expect(info?.modified).toEqual({ id: `item1`, name: `Updated Item 1` })
      expect(info?.original).toEqual({ id: `item1`, name: `Item 1` })
      expect(info?.changes).toEqual({ name: `Updated Item 1` })
      expect(info?.mutations).toHaveLength(1)
      expect(info?.mutations[0]?.type).toBe(`update`)
    })

    it(`accumulates changes from multiple updates`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)
      const tx = createTransaction({ mutationFn })

      tx.mutate(() => {
        collection.update(`item1`, (draft) => {
          draft.name = `Updated Item 1`
        })
        collection.update(`item1`, (draft) => {
          draft.count = 42
        })
      })

      const info = collection.getOptimisticInfo(`item1`)
      expect(info).toBeDefined()
      expect(info?.isOptimistic).toBe(true)
      expect(info?.modified).toEqual({
        id: `item1`,
        name: `Updated Item 1`,
        count: 42,
      })
      expect(info?.original).toEqual({ id: `item1`, name: `Item 1` })
      expect(info?.changes).toEqual({ name: `Updated Item 1`, count: 42 })
      expect(info?.mutations).toHaveLength(1) // Merged into one mutation
    })

    it(`returns isOptimistic: false after transaction completes`, async () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)
      const tx = createTransaction({ mutationFn })

      tx.mutate(() => {
        collection.update(`item1`, (draft) => {
          draft.name = `Updated Item 1`
        })
      })

      // Before commit
      expect(collection.getOptimisticInfo(`item1`)?.isOptimistic).toBe(true)

      // Wait for transaction to complete (auto-commits)
      await tx.isPersisted.promise

      // After commit
      const info = collection.getOptimisticInfo(`item1`)
      expect(info?.isOptimistic).toBe(false)
      expect(info?.mutations).toHaveLength(0)
    })
  })

  describe(`optimistic delete`, () => {
    it(`returns undefined for optimistically deleted record`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)
      const tx = createTransaction({ mutationFn })

      tx.mutate(() => {
        collection.delete(`item1`)
      })

      const info = collection.getOptimisticInfo(`item1`)
      expect(info).toBeUndefined() // Record no longer exists
    })

    it(`removes optimistic delete state after transaction completes`, async () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)
      const tx = createTransaction({ mutationFn })

      tx.mutate(() => {
        collection.delete(`item1`)
      })

      // During optimistic delete
      expect(collection.getOptimisticInfo(`item1`)).toBeUndefined()

      // Wait for transaction to complete (auto-commits)
      await tx.isPersisted.promise

      // After commit, optimistic delete is removed but record still exists in synced data
      // (since the sync layer hasn't actually deleted it)
      const info = collection.getOptimisticInfo(`item1`)
      expect(info?.isOptimistic).toBe(false)
      expect(info?.modified).toEqual({ id: `item1`, name: `Item 1` })
    })
  })

  describe(`multiple transactions`, () => {
    it(`tracks mutations from multiple active transactions`, () => {
      const mutationFn1 = vi.fn().mockResolvedValue(undefined)
      const mutationFn2 = vi.fn().mockResolvedValue(undefined)

      const tx1 = createTransaction({ mutationFn: mutationFn1 })
      const tx2 = createTransaction({ mutationFn: mutationFn2 })

      tx1.mutate(() => {
        collection.update(`item1`, (draft) => {
          draft.name = `Updated by tx1`
        })
      })

      tx2.mutate(() => {
        collection.update(`item1`, (draft) => {
          draft.count = 99
        })
      })

      const info = collection.getOptimisticInfo(`item1`)
      expect(info).toBeDefined()
      expect(info?.isOptimistic).toBe(true)
      expect(info?.mutations).toHaveLength(2)
      expect(info?.mutations[0]?.type).toBe(`update`)
      expect(info?.mutations[1]?.type).toBe(`update`)
    })
  })

  describe(`insert then update`, () => {
    it(`tracks optimistic insert followed by update`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)
      const tx = createTransaction({ mutationFn })

      tx.mutate(() => {
        collection.insert({ id: `item3`, name: `Item 3` })
        collection.update(`item3`, (draft) => {
          draft.count = 10
        })
      })

      const info = collection.getOptimisticInfo(`item3`)
      expect(info).toBeDefined()
      expect(info?.isOptimistic).toBe(true)
      expect(info?.modified).toEqual({
        id: `item3`,
        name: `Item 3`,
        count: 10,
      })
      expect(info?.original).toBeUndefined() // Still an insert
      expect(info?.mutations).toHaveLength(1) // Merged into one insert mutation
      expect(info?.mutations[0]?.type).toBe(`insert`)
    })
  })

  describe(`non-optimistic mutations`, () => {
    it(`ignores mutations with optimistic: false`, () => {
      const mutationFn = vi.fn().mockResolvedValue(undefined)
      const tx = createTransaction({ mutationFn })

      tx.mutate(() => {
        collection.update(`item1`, { optimistic: false }, (draft) => {
          draft.name = `Non-optimistic update`
        })
      })

      const info = collection.getOptimisticInfo(`item1`)
      expect(info).toBeDefined()
      expect(info?.isOptimistic).toBe(false) // No optimistic mutations
      expect(info?.mutations).toHaveLength(0)
    })
  })
})
