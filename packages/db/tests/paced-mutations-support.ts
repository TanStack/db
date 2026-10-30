/**
 * Helpers shared by the paced-mutation oracle and its ordinary scenario tests:
 * a ready collection, cleanup that keeps the first failure, and a receipt
 * observer. The law lives in paced-mutations-oracle.test.ts.
 */

import { createCollection } from '../src/collection'
import { mockSyncCollectionOptionsNoInitialState } from './utils'
import type { Strategy } from '../src/strategies/types'
import type { Transaction } from '../src/transactions'

export type Start = { at: number; ids: Array<number> }

export const origin = 1_000_000

export async function createReadyCollection<
  T extends { id: number } = { id: number },
>(initial: Array<T> = []) {
  const collection = createCollection(
    mockSyncCollectionOptionsNoInitialState<T>({
      id: `paced-oracle`,
      getKey: (item) => item.id,
    }),
  )
  const preload = collection.preload()
  collection.utils.begin()
  for (const row of initial)
    collection.utils.write({ type: `insert`, value: row })
  collection.utils.commit()
  collection.utils.markReady()
  await preload
  return collection
}

// Keep the violated law as the primary cause if cleanup also fails. Release
// every resource even when an earlier cleanup step throws.
export async function withCleanup<T>(
  strategy: Strategy,
  collection: { cleanup: () => Promise<void> },
  run: () => Promise<T>,
  release?: () => Promise<void>,
): Promise<T> {
  const outcome = await Promise.resolve()
    .then(run)
    .then(
      (value) => ({ ok: true, value }) as const,
      (error: unknown) => ({ ok: false, error }) as const,
    )
  const cleanupErrors: Array<unknown> = []
  try {
    await release?.()
  } catch (error) {
    cleanupErrors.push(error)
  }
  try {
    strategy.cleanup()
  } catch (error) {
    cleanupErrors.push(error)
  }
  try {
    await collection.cleanup()
  } catch (error) {
    cleanupErrors.push(error)
  }

  if (!outcome.ok) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, `Oracle cleanup also failed`, {
        cause: outcome.error,
      })
    }
    throw outcome.error
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `Oracle cleanup failed`)
  }
  return outcome.value
}

export function observeReceipt<T extends object>(transaction: Transaction<T>) {
  const receipt: {
    outcome: `pending` | `fulfilled` | `rejected`
    returnedSame?: boolean
    error?: unknown
  } = { outcome: `pending` }
  void transaction.when('settled').then(
    (resolved) => {
      receipt.outcome = `fulfilled`
      receipt.returnedSame = resolved === transaction
    },
    (error: unknown) => {
      receipt.outcome = `rejected`
      receipt.error = error
    },
  )
  return receipt
}
