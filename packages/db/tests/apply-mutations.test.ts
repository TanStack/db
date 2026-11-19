import { describe, expect, it } from 'vitest'
import { createTransaction } from '../src/transactions'
import { createCollection } from '../src/collection'
import { mockSyncCollectionOptions } from './utils'

describe(`applyMutations merge logic`, () => {
  // Create a shared collection for all tests
  const createMockCollection = () =>
    createCollection<{
      id: string
      name: string
      value?: number
    }>({
      id: `test-collection`,
      getKey: (item) => item.id,
      onInsert: async () => {}, // Add required handler
      onUpdate: async () => {}, // Add required handler
      onDelete: async () => {}, // Add required handler
      sync: {
        sync: () => {},
      },
    })

  it(`should merge update after insert correctly`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })
    const collection = createMockCollection()

    // Insert then update the same item within the transaction
    transaction.mutate(() => {
      collection.insert({ id: `item-1`, name: `Original Name` })
    })

    transaction.mutate(() => {
      collection.update(`item-1`, (draft) => {
        draft.name = `Updated Name`
        draft.value = 42
      })
    })

    expect(transaction.mutations).toHaveLength(1)
    const finalMutation = transaction.mutations[0]!

    // Should remain an insert with empty original
    expect(finalMutation.type).toBe(`insert`)
    expect(finalMutation.original).toEqual({})

    // Should have the final modified state from the update
    expect(finalMutation.modified.id).toBe(`item-1`)
    expect(finalMutation.modified.name).toBe(`Updated Name`)
    expect(finalMutation.modified.value).toBe(42)
  })

  it(`should remove both mutations when delete follows insert`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })
    const collection = createMockCollection()

    // Insert then delete the same item
    transaction.mutate(() => {
      collection.insert({ id: `item-1`, name: `Original Name` })
    })

    transaction.mutate(() => {
      collection.delete(`item-1`)
    })

    // Both mutations should cancel out - no mutations should remain
    expect(transaction.mutations).toHaveLength(0)
  })

  it(`should replace update with delete (current behavior)`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })
    const collection = createMockCollection()

    // Add an item first so we can update it
    collection.insert({ id: `item-1`, name: `Original Name` })

    // Update then delete
    transaction.mutate(() => {
      collection.update(`item-1`, (draft) => {
        draft.name = `Updated Name`
      })
    })

    transaction.mutate(() => {
      collection.delete(`item-1`)
    })

    expect(transaction.mutations).toHaveLength(1)
    const finalMutation = transaction.mutations[0]!

    // Should be a delete mutation
    expect(finalMutation.type).toBe(`delete`)
  })

  it(`should handle multiple updates after insert correctly`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })
    const collection = createMockCollection()

    // Insert, then multiple updates
    transaction.mutate(() => {
      collection.insert({ id: `item-1`, name: `Original` })
    })

    transaction.mutate(() => {
      collection.update(`item-1`, (draft) => {
        draft.name = `Updated`
        draft.value = 10
      })
    })

    transaction.mutate(() => {
      collection.update(`item-1`, (draft) => {
        draft.name = `Final`
        draft.value = 20
      })
    })

    expect(transaction.mutations).toHaveLength(1)
    const finalMutation = transaction.mutations[0]!

    // Should still be an insert
    expect(finalMutation.type).toBe(`insert`)
    expect(finalMutation.original).toEqual({})

    // Should have the final state
    expect(finalMutation.modified.id).toBe(`item-1`)
    expect(finalMutation.modified.name).toBe(`Final`)
    expect(finalMutation.modified.value).toBe(20)
  })

  it(`should handle delete after insert-update chain`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })
    const collection = createMockCollection()

    // Insert, update, then delete
    transaction.mutate(() => {
      collection.insert({ id: `item-1`, name: `Original` })
    })

    transaction.mutate(() => {
      collection.update(`item-1`, (draft) => {
        draft.name = `Updated`
      })
    })

    transaction.mutate(() => {
      collection.delete(`item-1`)
    })

    // Should have no mutations (all canceled out)
    expect(transaction.mutations).toHaveLength(0)
  })
  describe(`update pair against the authoritative row`, () => {
    type Row = { id: number; value: number }
    const createSyncedCollection = () =>
      createCollection(
        mockSyncCollectionOptions<Row>({
          id: `update-pair-authoritative`,
          getKey: (row) => row.id,
          initialData: [{ id: 1, value: 0 }],
        }),
      )
    const manualTransaction = () =>
      createTransaction<Row>({
        mutationFn: async () => {},
        autoCommit: false,
      })

    it(`keeps the latest write when another transaction still holds the row`, () => {
      const collection = createSyncedCollection()
      const other = manualTransaction()
      other.mutate(() => {
        collection.update(1, (draft) => {
          draft.value = 1
        })
      })

      const transaction = manualTransaction()
      transaction.mutate(() => {
        collection.update(1, (draft) => {
          draft.value = 2
        })
      })
      transaction.mutate(() => {
        collection.update(1, (draft) => {
          draft.value = 0
        })
      })

      expect(transaction.mutations).toHaveLength(1)
      expect(transaction.mutations[0]!.modified).toEqual({ id: 1, value: 0 })
      expect(transaction.mutations[0]!.changes).toEqual({ value: 0 })
      expect(collection.get(1)?.value).toBe(0)
    })

    it(`keeps the restoring write when another transaction wrote the row in between`, () => {
      const collection = createSyncedCollection()
      const transaction = manualTransaction()
      transaction.mutate(() => {
        collection.update(1, (draft) => {
          draft.value = 2
        })
      })

      const other = manualTransaction()
      other.mutate(() => {
        collection.update(1, (draft) => {
          draft.value = 1
        })
      })

      transaction.mutate(() => {
        collection.update(1, (draft) => {
          draft.value = 0
        })
      })

      expect(transaction.mutations).toHaveLength(1)
      expect(transaction.mutations[0]!.modified).toEqual({ id: 1, value: 0 })
      expect(transaction.mutations[0]!.changes).toEqual({ value: 0 })
    })

    it(`keeps a written-back field when sync moved the row meanwhile`, () => {
      const collection = createSyncedCollection()
      const transaction = manualTransaction()
      transaction.mutate(() => {
        collection.update(1, (draft) => {
          draft.value = 1
        })
      })

      collection.utils.begin()
      collection.utils.write({ type: `update`, value: { id: 1, value: 5 } })
      collection.utils.commit()

      transaction.mutate(() => {
        collection.update(1, (draft) => {
          draft.value = 0
        })
      })

      expect(transaction.mutations).toHaveLength(1)
      expect(transaction.mutations[0]!.changes).toEqual({ value: 0 })
    })
  })
})
