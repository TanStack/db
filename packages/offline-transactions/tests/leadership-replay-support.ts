// Shared fixtures for the leadership replay tests: the stored offline
// transaction record. The laws are owned by
// leadership-replay-oracle.property.test.ts.
import type { OfflineTransaction } from '../src/types'

export const storedTransaction = (id: string): OfflineTransaction => ({
  id,
  mutationFnName: `syncData`,
  mutations: [],
  keys: [],
  idempotencyKey: `${id}/once`,
  createdAt: new Date(0),
  retryCount: 0,
  nextAttemptAt: 0,
  version: 1,
})
