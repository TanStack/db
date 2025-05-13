import { describe, expect, it } from "vitest"
import type {
  MutationFactoryConfig,
  PendingMutation,
  Transaction,
  TransactionConfig,
  TransactionState,
} from "../src/types"

describe(`Transaction Types`, () => {
  it(`should validate PendingMutation structure with collectionId`, () => {
    // Type assertion test - this will fail at compile time if the type is incorrect
    const pendingMutation: PendingMutation = {
      mutationId: `test-mutation-1`,
      original: { id: 1, name: `Original` },
      modified: { id: 1, name: `Modified` },
      changes: { name: `Modified` },
      key: `1`,
      type: `update`,
      metadata: null,
      syncMetadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      collectionId: `users`, // New required field
    }

    expect(pendingMutation.collectionId).toBe(`users`)
    expect(pendingMutation.type).toBe(`update`)
  })

  it(`should validate TransactionConfig structure`, () => {
    // Empty config is valid
    const minimalConfig: TransactionConfig = {}
    expect(minimalConfig).toBeDefined()

    // Full config
    const fullConfig: TransactionConfig = {
      id: `custom-transaction-id`,
      metadata: { source: `user-form` },
    }

    expect(fullConfig.id).toBe(`custom-transaction-id`)
    expect(fullConfig.metadata).toEqual({ source: `user-form` })
  })

  it(`should validate Transaction structure`, () => {
    const mockToObject = () => ({
      id: `test-transaction`,
      state: `pending` as TransactionState,
      createdAt: new Date(),
      updatedAt: new Date(),
      mutations: [],
      metadata: {},
    })

    const transaction: Transaction = {
      id: `test-transaction`,
      state: `pending`,
      createdAt: new Date(),
      updatedAt: new Date(),
      mutations: [],
      metadata: {},
      toObject: mockToObject,
    }

    expect(transaction.id).toBe(`test-transaction`)

    // Test toObject method
    const plainObject = transaction.toObject()
    expect(plainObject.id).toBe(`test-transaction`)
    expect(plainObject).not.toHaveProperty(`toObject`)
  })

  it(`should validate MutationFactoryConfig structure`, () => {
    // Minimal config with just the required mutationFn
    const minimalConfig: MutationFactoryConfig = {
      mutationFn: async () => {
        return Promise.resolve({ success: true })
      },
    }

    expect(typeof minimalConfig.mutationFn).toBe(`function`)

    // Full config with metadata
    const fullConfig: MutationFactoryConfig = {
      mutationFn: async () => {
        return Promise.resolve({ success: true })
      },
      metadata: { source: `signup-form` },
    }

    expect(fullConfig.metadata).toEqual({ source: `signup-form` })
  })
})
