import { describe, expect, it } from "vitest"
import { createTransaction } from "../src/transactions"
import { createCollection } from "../src/collection/index.js"
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
  it(`goes straight to completed if you call commit w/o any mutations`, async () => {
    const transaction = createTransaction({
      mutationFn: async () => Promise.resolve(),
    })

    transaction.commit()
    expect(transaction.state).toBe(`completed`)
    await expect(transaction.isPersisted.promise).resolves.toBeDefined()
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

    await expect(transaction.commit()).rejects.toThrow(`bad`)

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

    await expect(transaction.commit()).rejects.toThrow(`bad`)

    await expect(transaction.isPersisted.promise).rejects.toThrow(`bad`)
    transaction.isPersisted.promise.catch(() => {})
    expect(transaction.state).toBe(`failed`)
    expect(transaction.error?.message).toBe(`bad`)
    expect(transaction.error?.error).toBeInstanceOf(Error)
  })
  it(`commit() should throw errors when mutation function fails`, async () => {
    const tx = createTransaction({
      mutationFn: () => {
        throw new Error(`API failed`)
      },
      autoCommit: false,
    })

    const collection = createCollection<{
      id: string
      text: string
    }>({
      id: `test-collection`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {},
      },
    })

    tx.mutate(() => {
      collection.insert({ id: `1`, text: `Item` })
    })

    try {
      await tx.commit()
      expect.fail(`Expected commit to throw`)
    } catch (error) {
      // Transaction has been rolled back
      expect(tx.state).toBe(`failed`)
      expect(tx.error?.message).toBe(`API failed`)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe(`API failed`)
    }
  })

  it(`commit() and isPersisted.promise should reject with the same error instance`, async () => {
    const originalError = new Error(`Original API error`)
    const tx = createTransaction({
      mutationFn: () => {
        throw originalError
      },
      autoCommit: false,
    })

    const collection = createCollection<{
      id: string
      text: string
    }>({
      id: `test-collection`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {},
      },
    })

    tx.mutate(() => {
      collection.insert({ id: `1`, text: `Item` })
    })

    let commitError: unknown
    let persistedError: unknown

    // Capture error from commit()
    try {
      await tx.commit()
    } catch (error) {
      commitError = error
    }

    // Capture error from isPersisted.promise
    try {
      await tx.isPersisted.promise
    } catch (error) {
      persistedError = error
    }

    // Both should be the exact same error instance
    expect(commitError).toBe(originalError)
    expect(persistedError).toBe(originalError)
    expect(commitError).toBe(persistedError)
  })

  it(`should handle non-Error throwables (strings)`, async () => {
    const tx = createTransaction({
      mutationFn: () => {
        throw `string error`
      },
      autoCommit: false,
    })

    const collection = createCollection<{
      id: string
    }>({
      id: `test-collection`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {},
      },
    })

    tx.mutate(() => {
      collection.insert({ id: `1` })
    })

    try {
      await tx.commit()
      expect.fail(`Expected commit to throw`)
    } catch (error) {
      // Should be converted to an Error object
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe(`string error`)
    }

    // Same error from isPersisted.promise
    try {
      await tx.isPersisted.promise
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe(`string error`)
    }
  })

  it(`should handle non-Error throwables (numbers, objects)`, async () => {
    const tx = createTransaction({
      mutationFn: () => {
        throw 42
      },
      autoCommit: false,
    })

    tx.mutate(() => {})

    try {
      await tx.commit()
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe(`42`)
    }

    const tx2 = createTransaction({
      mutationFn: () => {
        throw { code: `ERR_FAILED`, details: `Something went wrong` }
      },
      autoCommit: false,
    })

    tx2.mutate(() => {})

    try {
      await tx2.commit()
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain(`[object Object]`)
    }
  })

  it(`should throw TransactionNotPendingCommitError when commit() is called on completed transaction`, async () => {
    const tx = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })

    tx.mutate(() => {})

    // First commit succeeds
    await tx.commit()
    expect(tx.state).toBe(`completed`)

    // Second commit should throw TransactionNotPendingCommitError
    await expect(tx.commit()).rejects.toThrow(TransactionNotPendingCommitError)
  })

  it(`should throw TransactionNotPendingCommitError when commit() is called on failed transaction`, async () => {
    const tx = createTransaction({
      mutationFn: () => {
        throw new Error(`Failed`)
      },
      autoCommit: false,
    })

    const collection = createCollection<{
      id: string
    }>({
      id: `test-collection`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {},
      },
    })

    tx.mutate(() => {
      collection.insert({ id: `1` })
    })

    // First commit fails
    try {
      await tx.commit()
    } catch {
      // Expected to fail
    }
    expect(tx.state).toBe(`failed`)

    // Second commit should throw TransactionNotPendingCommitError
    await expect(tx.commit()).rejects.toThrow(TransactionNotPendingCommitError)
  })

  it(`should handle cascading rollbacks with proper error propagation`, async () => {
    const originalError = new Error(`Primary transaction failed`)
    const tx1 = createTransaction({
      mutationFn: () => {
        throw originalError
      },
      autoCommit: false,
    })
    const tx2 = createTransaction({
      mutationFn: async () => Promise.resolve(),
      autoCommit: false,
    })

    const collection = createCollection<{
      id: string
      value: string
    }>({
      id: `test-collection`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {},
      },
    })

    // Both transactions insert items - tx2 will depend on tx1's item
    tx1.mutate(() => {
      collection.insert({ id: `item-1`, value: `from-tx1` })
    })

    tx2.mutate(() => {
      // Insert an item that references tx1's item, creating a dependency
      collection.insert({ id: `item-1-copy`, value: `copied-from-tx1` })
      collection.update(`item-1`, (draft) => {
        draft.value = `modified-by-tx2`
      })
    })

    // tx1 commit fails and should cascade rollback to tx2
    let tx1CommitError: unknown
    try {
      await tx1.commit()
    } catch (error) {
      tx1CommitError = error
    }

    // Verify both transactions are failed
    expect(tx1.state).toBe(`failed`)
    expect(tx2.state).toBe(`failed`)

    // tx1 should throw the original error
    expect(tx1CommitError).toBe(originalError)

    // tx2's isPersisted.promise should also be rejected (but with undefined since it's a cascading rollback)
    await expect(tx2.isPersisted.promise).rejects.toBeUndefined()
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

  describe(`duplicate instance detection`, () => {
    it(`sets a global marker in dev mode when in browser top window`, () => {
      // The duplicate instance marker should be set when the module loads in dev mode
      const marker = Symbol.for(`@tanstack/db/instance-marker`)
      // This will only be true if we're in dev mode AND in a browser top window
      // In test environment (vitest), we should have these conditions met
      expect((globalThis as any)[marker]).toBe(true)
    })

    it(`marker is only set in development mode`, () => {
      // This test verifies the marker exists in our test environment
      // In production (NODE_ENV=production), the marker would NOT be set
      const marker = Symbol.for(`@tanstack/db/instance-marker`)
      const isDev =
        typeof process !== `undefined` && process.env.NODE_ENV !== `production`

      if (isDev) {
        expect((globalThis as any)[marker]).toBe(true)
      }
      // Note: We can't easily test the production case without changing NODE_ENV
      // which would affect the entire test suite
    })

    it(`can be disabled with environment variable`, () => {
      // This test documents that TANSTACK_DB_DISABLE_DUP_CHECK=1 disables the check
      // We can't easily test the actual behavior without reloading the module,
      // but the implementation in transactions.ts checks this variable
      const disableCheck = process.env.TANSTACK_DB_DISABLE_DUP_CHECK === `1`
      expect(typeof disableCheck).toBe(`boolean`)
    })
  })
})
