// Shared fixtures for the leadership replay tests: a gate for ordering
// controlled storage and provider events, a macrotask turn, and the stored
// offline transaction record. The laws are owned by
// leadership-replay-oracle.property.test.ts.
import type { OfflineTransaction } from '../src/types'

export function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

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
