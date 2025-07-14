import { describe, expect, it } from "vitest"
import type { Collection } from "../src/collection"
import type {
  MutationFn,
  PendingMutation,
  Transaction,
  TransactionConfig,
} from "../src/types"

describe(`Transaction Types`, () => {
  it(`should validate PendingMutation structure with collection`, () => {
    // Create a mock collection
    const mockCollection = {} as Collection<{ id: number; name: string }>

    // Type assertion test - this will fail at compile time if the type is incorrect
    const pendingMutation: PendingMutation<{ id: number; name: string }> = {
      mutationId: `test-mutation-1`,
      original: { id: 1, name: `Original` },
      modified: { id: 1, name: `Modified` },
      changes: { name: `Modified` },
      key: `1`,
      globalKey: `1`,
      type: `update`,
      metadata: null,
      syncMetadata: {},
      optimistic: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      collection: mockCollection,
    }

    expect(pendingMutation.collection).toBe(mockCollection)
    expect(pendingMutation.type).toBe(`update`)
  })

  it(`should validate TransactionConfig structure`, () => {
    // Minimal config with required mutationFn
    const mockMutationFn: MutationFn = async () => Promise.resolve()
    const minimalConfig: TransactionConfig = {
      mutationFn: mockMutationFn,
    }
    expect(minimalConfig).toBeDefined()

    // Full config
    const fullConfig: TransactionConfig = {
      id: `custom-transaction-id`,
      mutationFn: mockMutationFn,
      metadata: { source: `user-form` },
    }

    expect(fullConfig.id).toBe(`custom-transaction-id`)
    expect(fullConfig.metadata).toEqual({ source: `user-form` })
  })

  it(`should validate Transaction structure`, () => {
    // Create a mock Transaction object with all required properties
    const mockMutationFn: MutationFn = async () => Promise.resolve()

    // Create a complete mock Transaction object with all required methods
    const transaction = {
      id: `test-transaction`,
      state: `pending`,
      createdAt: new Date(),
      mutations: [],
      metadata: {},
      mutationFn: mockMutationFn,
      isPersisted: false,
      autoCommit: false,
      setState: () => {},
      commit: async () => Promise.resolve(),
      rollback: async () => Promise.resolve(),
      reset: () => {},
      addMutation: () => {},
      // Add missing methods
      mutate: async () => Promise.resolve(),
      applyMutations: () => {},
      touchCollection: () => {},
    } as unknown as Transaction

    expect(transaction.id).toBe(`test-transaction`)
  })

  it(`should validate TransactionConfig with metadata`, () => {
    // Minimal config with just the required mutationFn
    const minimalConfig: TransactionConfig = {
      mutationFn: async () => {
        return Promise.resolve({ success: true })
      },
    }

    expect(typeof minimalConfig.mutationFn).toBe(`function`)

    // Full config with metadata
    const fullConfig: TransactionConfig = {
      mutationFn: async () => {
        return Promise.resolve({ success: true })
      },
      metadata: { source: `signup-form` },
    }

    expect(fullConfig.metadata).toEqual({ source: `signup-form` })
  })
})
