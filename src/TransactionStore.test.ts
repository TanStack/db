import { describe, it, expect, beforeEach } from "vitest"
import { TransactionStore } from "./TransactionStore"
import type { Transaction, TransactionState } from "./types"
import "fake-indexeddb/auto"

describe(`TransactionStore`, () => {
  let store: TransactionStore

  beforeEach(async () => {
    // Reset store for each test
    store = new TransactionStore()
    await store.clearAll()
  })

  function createMockTransaction(id: string): Transaction {
    return {
      id,
      state: `pending` as TransactionState,
      createdAt: new Date(),
      updatedAt: new Date(),
      mutations: [],
      strategy: { type: `ordered` },
      metadata: {},
      toObject: () => {
        return {} as Transaction
      },
    }
  }

  it(`should store and retrieve a transaction`, async () => {
    const tx = createMockTransaction(`test-1`)
    await store.putTransaction(tx)

    const transactions = await store.getTransactions()
    expect(transactions).toHaveLength(1)
    expect(transactions[0].id).toBe(`test-1`)
  })

  it(`should update an existing transaction`, async () => {
    const tx = createMockTransaction(`test-2`)
    await store.putTransaction(tx)

    // Modify and update
    const updatedTx = { ...tx, state: `completed` as const }
    await store.putTransaction(updatedTx)

    const transactions = await store.getTransactions()
    expect(transactions).toHaveLength(1)
    expect(transactions[0].state).toBe(`completed`)
  })

  it(`should delete a transaction`, async () => {
    const tx = createMockTransaction(`test-3`)
    await store.putTransaction(tx)

    await store.deleteTransaction(tx.id)
    const transactions = await store.getTransactions()
    expect(transactions).toHaveLength(0)
  })

  it(`should handle multiple transactions`, async () => {
    const tx1 = createMockTransaction(`test-4a`)
    const tx2 = createMockTransaction(`test-4b`)
    const tx3 = createMockTransaction(`test-4c`)

    await Promise.all([
      store.putTransaction(tx1),
      store.putTransaction(tx2),
      store.putTransaction(tx3),
    ])

    const transactions = await store.getTransactions()
    expect(transactions).toHaveLength(3)
    expect(transactions.map((t) => t.id).sort()).toEqual([
      `test-4a`,
      `test-4b`,
      `test-4c`,
    ])
  })

  it(`should handle non-existent transaction deletion gracefully`, async () => {
    await expect(store.deleteTransaction(`non-existent`)).resolves.not.toThrow()
  })
})
