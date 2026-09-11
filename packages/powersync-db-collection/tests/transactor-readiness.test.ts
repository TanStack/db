import { createCollection, createTransaction } from '@tanstack/db'
import { expect, it, vi } from 'vitest'
import { PowerSyncTransactor } from '../src/PowerSyncTransactor'
import type { AbstractPowerSyncDatabase } from '@powersync/common'

it.each([`cleanup`, `error`, `ready`] as const)(
  `settles a transaction waiting for source readiness on %s`,
  async (outcome) => {
    const writeTransaction = vi
      .fn()
      .mockResolvedValue({ whenComplete: Promise.resolve() })
    // This boundary must settle before taking a database lock; no SQL runs.
    const transactor = new PowerSyncTransactor({
      database: { writeTransaction } as unknown as AbstractPowerSyncDatabase,
    })
    let markSourceReady!: () => void
    const collection = createCollection<{ id: string }>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markSourceReady = markReady
          return {}
        },
      },
    })
    collection.startSyncImmediate()
    const transaction = createTransaction({
      autoCommit: false,
      mutationFn: async () => {},
    })
    transaction.mutate(() => collection.insert({ id: `pending` }))
    let result: { error: unknown } | { ready: true } | undefined
    const waiting = transactor.applyTransaction(transaction).then(
      () => {
        result = { ready: true }
      },
      (error: unknown) => {
        result = { error }
      },
    )
    const failure = new Error(`source failed before readiness`)
    try {
      expect(collection.status).toBe(`loading`)
      if (outcome === `cleanup`) await collection.cleanup()
      else if (outcome === `error`) collection._lifecycle.markError(failure)
      else markSourceReady()
      // Drain promise reactions without waiting on the possibly orphaned wait.
      for (let turn = 0; turn < 10; turn++) await Promise.resolve()
      expect(result).toBeDefined()
      expect(result).toEqual(
        outcome === `ready`
          ? { ready: true }
          : {
              error:
                outcome === `error`
                  ? failure
                  : expect.objectContaining({ name: `AbortError` }),
            },
      )
      await waiting
      expect(writeTransaction).toHaveBeenCalledTimes(
        outcome === `ready` ? 1 : 0,
      )
    } finally {
      transaction.rollback()
      await collection.cleanup()
    }
  },
)
