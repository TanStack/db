import { describe, expect, it } from "vitest"
import { createTransaction } from "../src/transactions"
import { createCollection } from "../src/collection"
import type { PendingMutation } from "../src/types"

describe(`applyMutations merge logic`, () => {
  const createMockCollection = () =>
    createCollection<{
      id: string
      name: string
      value?: number
    }>({
      id: `test-collection`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {},
      },
    })

  const createMockMutation = (
    type: `insert` | `update` | `delete`,
    globalKey: string,
    original: any,
    modified: any,
    changes: any
  ): PendingMutation => ({
    mutationId: crypto.randomUUID(),
    type,
    original,
    modified,
    changes,
    globalKey,
    key: globalKey,
    metadata: null,
    syncMetadata: {},
    optimistic: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    collection: createMockCollection() as any,
  })

  it(`should merge update after insert correctly`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })

    // First, apply an insert mutation
    const insertMutation = createMockMutation(
      `insert`,
      `item-1`,
      {},
      { id: `item-1`, name: `Original Name` },
      { id: `item-1`, name: `Original Name` }
    )
    transaction.applyMutations([insertMutation])

    // Then apply an update mutation for the same item
    const updateMutation = createMockMutation(
      `update`,
      `item-1`,
      { id: `item-1`, name: `Original Name` },
      { id: `item-1`, name: `Updated Name`, value: 42 },
      { name: `Updated Name`, value: 42 }
    )
    transaction.applyMutations([updateMutation])

    expect(transaction.mutations).toHaveLength(1)
    const finalMutation = transaction.mutations[0]

    // Should remain an insert with empty original
    expect(finalMutation.type).toBe(`insert`)
    expect(finalMutation.original).toEqual({})

    // Should have the final modified state from the update
    expect(finalMutation.modified).toEqual({
      id: `item-1`,
      name: `Updated Name`,
      value: 42,
    })

    // Should merge changes from both mutations
    expect(finalMutation.changes).toEqual({
      id: `item-1`,
      name: `Updated Name`,
      value: 42,
    })
  })

  it(`should remove both mutations when delete follows insert`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })

    // First, apply an insert mutation
    const insertMutation = createMockMutation(
      `insert`,
      `item-1`,
      {},
      { id: `item-1`, name: `Original Name` },
      { id: `item-1`, name: `Original Name` }
    )
    transaction.applyMutations([insertMutation])

    // Then apply a delete mutation for the same item
    const deleteMutation = createMockMutation(
      `delete`,
      `item-1`,
      { id: `item-1`, name: `Original Name` },
      { id: `item-1`, name: `Original Name` },
      { id: `item-1`, name: `Original Name` }
    )
    transaction.applyMutations([deleteMutation])

    // Both mutations should cancel out - no mutations should remain
    expect(transaction.mutations).toHaveLength(0)
  })

  it(`should replace update with delete (current behavior)`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })

    // First, apply an update mutation
    const updateMutation = createMockMutation(
      `update`,
      `item-1`,
      { id: `item-1`, name: `Original Name` },
      { id: `item-1`, name: `Updated Name` },
      { name: `Updated Name` }
    )
    transaction.applyMutations([updateMutation])

    // Then apply a delete mutation for the same item
    const deleteMutation = createMockMutation(
      `delete`,
      `item-1`,
      { id: `item-1`, name: `Updated Name` },
      { id: `item-1`, name: `Updated Name` },
      { id: `item-1`, name: `Updated Name` }
    )
    transaction.applyMutations([deleteMutation])

    expect(transaction.mutations).toHaveLength(1)
    const finalMutation = transaction.mutations[0]

    // Should be a delete mutation
    expect(finalMutation.type).toBe(`delete`)
    expect(finalMutation).toBe(deleteMutation)
  })

  it(`should handle multiple updates after insert correctly`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })

    // Insert
    const insertMutation = createMockMutation(
      `insert`,
      `item-1`,
      {},
      { id: `item-1`, name: `Original` },
      { id: `item-1`, name: `Original` }
    )
    transaction.applyMutations([insertMutation])

    // First update
    const update1Mutation = createMockMutation(
      `update`,
      `item-1`,
      { id: `item-1`, name: `Original` },
      { id: `item-1`, name: `Updated`, value: 10 },
      { name: `Updated`, value: 10 }
    )
    transaction.applyMutations([update1Mutation])

    // Second update
    const update2Mutation = createMockMutation(
      `update`,
      `item-1`,
      { id: `item-1`, name: `Updated`, value: 10 },
      { id: `item-1`, name: `Final`, value: 20 },
      { name: `Final`, value: 20 }
    )
    transaction.applyMutations([update2Mutation])

    expect(transaction.mutations).toHaveLength(1)
    const finalMutation = transaction.mutations[0]

    // Should still be an insert
    expect(finalMutation.type).toBe(`insert`)
    expect(finalMutation.original).toEqual({})

    // Should have the final state
    expect(finalMutation.modified).toEqual({
      id: `item-1`,
      name: `Final`,
      value: 20,
    })

    // Changes should include all fields that were changed
    expect(finalMutation.changes).toEqual({
      id: `item-1`,
      name: `Final`,
      value: 20,
    })
  })

  it(`should maintain default behavior for other mutation combinations`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })

    // Apply an update mutation
    const updateMutation1 = createMockMutation(
      `update`,
      `item-1`,
      { id: `item-1`, name: `Original` },
      { id: `item-1`, name: `Updated` },
      { name: `Updated` }
    )
    transaction.applyMutations([updateMutation1])

    // Apply another update mutation (should replace)
    const updateMutation2 = createMockMutation(
      `update`,
      `item-1`,
      { id: `item-1`, name: `Updated` },
      { id: `item-1`, name: `Final` },
      { name: `Final` }
    )
    transaction.applyMutations([updateMutation2])

    expect(transaction.mutations).toHaveLength(1)
    expect(transaction.mutations[0]).toBe(updateMutation2)
  })
})
