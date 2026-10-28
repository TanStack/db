// Fixtures shared by the KeyScheduler oracle and its ordinary unit tests in
// KeyScheduler-lifecycle.test.ts. They build transactions and a fixed clock.
import type { OfflineTransaction } from '../src/types'

export const BASE_TIME = Date.parse(`2026-01-01T00:00:00.000Z`)

export function createTransaction(
  id: string,
  createdAt: number,
  nextAttemptAt: number,
  payload: number,
): OfflineTransaction {
  return {
    id,
    mutationFnName: `syncData`,
    mutations: [],
    keys: [],
    idempotencyKey: `idempotency-${id}`,
    createdAt: new Date(createdAt),
    retryCount: 0,
    nextAttemptAt,
    metadata: { payload },
    version: 1,
  }
}
