import { describe, it, expect } from "vitest"
import type {
  Transaction,
  TransactionState,
  PendingMutation,
  Attempt,
  SyncConfig,
  MutationFn,
  MutationStrategy,
} from "./types"
import { NonRetriableError } from "./errors"
import { getLockedObjects } from "./utils"

describe(`Type definitions`, () => {
  it(`should allow creation of Transaction object`, () => {
    const transaction: Transaction = {
      id: `123`,
      state: `pending` as TransactionState,
      createdAt: new Date(),
      updatedAt: new Date(),
      mutations: [],
      attempts: [],
      currentAttempt: 0,
      strategy: {
        type: `ordered`,
      },
    }
    expect(transaction.id).toBe(`123`)
  })

  it(`should allow creation of PendingMutation object`, () => {
    const mutation: PendingMutation = {
      mutationId: `123`,
      original: {},
      modified: {},
      changes: {},
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      state: `created`,
    }
    expect(mutation.mutationId).toBe(`123`)
  })

  it(`should allow creation of Attempt object`, () => {
    const attempt: Attempt = {
      id: `123`,
      started_at: new Date(),
    }
    expect(attempt.id).toBe(`123`)
  })

  it(`should allow creation of SyncConfig object`, () => {
    const config: SyncConfig = {
      id: `123`,
      setup: async ({ onUpdate }) => {
        onUpdate({})
        return { data: {} }
      },
    }
    expect(config.id).toBe(`123`)
  })

  it(`should allow creation of MutationFn object`, () => {
    const mutationFn: MutationFn = {
      persist: async () => {},
    }
    expect(typeof mutationFn.persist).toBe(`function`)
  })

  it(`should allow creation of MutationStrategy object`, () => {
    const strategy: MutationStrategy = {
      type: `ordered`,
    }
    expect(strategy.type).toBe(`ordered`)
  })

  it(`should create NonRetriableError with correct name`, () => {
    const error = new NonRetriableError(`test error`)
    expect(error.name).toBe(`NonRetriableError`)
    expect(error.message).toBe(`test error`)
  })

  it(`should return empty Set from getLockedObjects`, () => {
    const result = getLockedObjects([])
    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })
})
