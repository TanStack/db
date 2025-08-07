import { describe, expect, it } from "vitest"
import { createTransaction } from "../src/transactions"
import { createCollection } from "../src/collection"
import {
  MissingMutationFunctionError,
  TransactionAlreadyCompletedRollbackError,
  TransactionNotPendingCommitError,
  TransactionNotPendingMutateError,
} from "../src/errors"

describe(`Transactions`, () => {
  it(`calling createTransaction creates a transaction`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
      metadata: { foo: true },
    })

    expect(transaction.commit).toBeTruthy()
    expect(transaction.metadata.foo).toBeTruthy()
  })
  it(`goes straight to completed if you call commit w/o any mutations`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
    })

    transaction.commit()
    expect(transaction.state).toBe(`completed`)
    expect(transaction.isPersisted.promise).resolves.toBeDefined()
  })
  it(`thows an error if you don't pass in mutationFn`, () => {
    // @ts-expect-error missing argument on purpose
    expect(() => createTransaction({})).toThrow(MissingMutationFunctionError)
  })
  it(`thows an error if call mutate or commit or rollback when it's completed`, async () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
    })

    await transaction.commit()

    await expect(transaction.commit()).rejects.toThrow(
      TransactionNotPendingCommitError
    )
    expect(() => transaction.rollback()).toThrow(
      TransactionAlreadyCompletedRollbackError
    )
    expect(() => transaction.mutate(() => {})).toThrow(
      TransactionNotPendingMutateError
    )
  })
  it(`should allow manually controlling the transaction lifecycle`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })
    const collection = createCollection<{
      id: number
      value: string
      newProp?: string
    }>({
      id: `foo`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {},
      },
    })

    transaction.mutate(() => {
      collection.insert({
        id: 1,
        value: `foo-me`,
        newProp: `something something`,
      })
    })
    transaction.mutate(() => {
      collection.insert({
        id: 2,
        value: `foo-me2`,
        newProp: `something something2`,
      })
    })

    expect(transaction.mutations).toHaveLength(2)

    transaction.commit()
  })
  it(`should allow mutating multiple collections`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })
    const collection1 = createCollection<{
      id: number
      value: string
      newProp?: string
    }>({
      id: `foo`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {},
      },
    })
    const collection2 = createCollection<{
      id: number
      value: string
      newProp?: string
    }>({
      id: `foo2`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {},
      },
    })

    transaction.mutate(() => {
      collection1.insert({
        id: 1,
        value: `foo-me1`,
        newProp: `something something`,
      })
      collection2.insert({
        id: 1,
        value: `foo-me2`,
        newProp: `something something`,
      })
    })

    expect(transaction.mutations).toHaveLength(2)

    transaction.commit()
  })
  it(`should allow devs to roll back manual transactions`, () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })
    const collection = createCollection<{
      id: number
      value: string
      newProp?: string
    }>({
      id: `foo`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {},
      },
    })

    transaction.mutate(() => {
      collection.insert({
        id: 1,
        value: `foo-me`,
        newProp: `something something`,
      })
    })

    transaction.rollback()

    transaction.isPersisted.promise.catch(() => {})
    expect(transaction.state).toBe(`failed`)
  })
  it(`should rollback if the mutationFn throws an error`, async () => {
    const transaction = createTransaction({
      mutationFn: async () => {
        await Promise.resolve()
        throw new Error(`bad`)
      },
      autoCommit: false,
    })
    const collection = createCollection<{
      id: number
      value: string
      newProp?: string
    }>({
      id: `foo`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {},
      },
    })

    transaction.mutate(() => {
      collection.insert({
        id: 1,
        value: `foo-me`,
        newProp: `something something`,
      })
    })

    transaction.commit()

    await expect(transaction.isPersisted.promise).rejects.toThrow(`bad`)
    transaction.isPersisted.promise.catch(() => {})
    expect(transaction.state).toBe(`failed`)
    expect(transaction.error?.message).toBe(`bad`)
    expect(transaction.error?.error).toBeInstanceOf(Error)
  })
  it(`should handle string errors as well`, async () => {
    const transaction = createTransaction({
      mutationFn: async () => {
        await Promise.resolve()
        throw `bad`
      },
      autoCommit: false,
    })
    const collection = createCollection<{
      id: number
      value: string
      newProp?: string
    }>({
      id: `foo`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {},
      },
    })

    transaction.mutate(() => {
      collection.insert({
        id: 1,
        value: `foo-me`,
        newProp: `something something`,
      })
    })

    transaction.commit()

    await expect(transaction.isPersisted.promise).rejects.toThrow(`bad`)
    transaction.isPersisted.promise.catch(() => {})
    expect(transaction.state).toBe(`failed`)
    expect(transaction.error?.message).toBe(`bad`)
    expect(transaction.error?.error).toBeInstanceOf(Error)
  })
  it(`should, when rolling back, find any other pending transactions w/ overlapping mutations and roll them back as well`, async () => {
    const transaction1 = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })
    const transaction2 = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })
    const transaction3 = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })
    const collection = createCollection<{
      id: number
      value: string
      newProp?: string
    }>({
      id: `foo`,
      getKey: (val) => val.id,
      sync: {
        sync: () => {},
      },
    })

    transaction1.mutate(() => {
      collection.insert({
        id: 1,
        value: `foo-me`,
        newProp: `something something`,
      })
    })

    transaction2.mutate(() => {
      collection.state.forEach((object) => {
        collection.update(object.id, (draft) => {
          draft.value = `foo-me-2`
        })
      })
    })

    transaction2.commit()
    await transaction2.isPersisted.promise

    transaction3.mutate(() => {
      collection.state.forEach((object) => {
        collection.update(object.id, (draft) => {
          draft.value = `foo-me-3`
        })
      })
    })

    transaction1.rollback()
    transaction1.isPersisted.promise.catch(() => {})
    transaction3.isPersisted.promise.catch(() => {})

    expect(transaction1.state).toBe(`failed`)
    expect(transaction2.state).toBe(`completed`)
    expect(transaction3.state).toBe(`failed`)
  })
})
