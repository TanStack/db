import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { createTransaction } from '../src/transactions.js'
import type { SyncConfig } from '../src/types.js'

// Shared collection and pending-transaction fixtures for the optimistic
// snapshot ownership tests and their oracle.
export type Row = { id: number; a: string; b: string; c: string }
export const initial: Row = { id: 1, a: `a0`, b: `b0`, c: `c0` }
export const orders = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

export function source(onUpdate = () => Promise.resolve()) {
  let sync!: Parameters<SyncConfig<Row>[`sync`]>[0]
  const collection = createCollection<Row>({
    getKey: (row) => row.id,
    onUpdate,
    sync: {
      sync: (params) => {
        sync = params
        params.begin()
        params.write({ type: `insert`, value: initial })
        params.commit()
        params.markReady()
      },
    },
  })
  return {
    collection,
    get sync() {
      return sync
    },
  }
}

export function pendingTransaction() {
  const done = createDeferred<void>()
  const tx = createTransaction({
    autoCommit: false,
    mutationFn: () => done.promise,
  })
  const settled = tx.isPersisted.promise.catch((error: unknown) => error)
  return { tx, done, settled }
}
