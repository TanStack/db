# Transaction API Reference

## createTransaction

```ts
import { createTransaction } from "@tanstack/db"

const tx = createTransaction<T>({
  id?: string,                        // defaults to safeRandomUUID()
  autoCommit?: boolean,               // default true -- commit after mutate()
  mutationFn: MutationFn<T>,          // (params: { transaction }) => Promise<any>
  metadata?: Record<string, unknown>, // custom data attached to the transaction
})
```

## Transaction Object

```ts
interface Transaction<T> {
  id: string
  state: 'pending' | 'persisting' | 'completed' | 'failed'
  mutations: Array<PendingMutation<T>>
  autoCommit: boolean
  createdAt: Date
  sequenceNumber: number
  metadata: Record<string, unknown>
  error?: { message: string; error: Error }

  // Deferred promise -- resolves when the transaction settles, rejects on
  // mutation failure or rollback
  isPersisted: {
    promise: Promise<Transaction<T>>
    resolve: (value: Transaction<T>) => void
    reject: (reason?: any) => void
  }

  // Execute collection operations inside the ambient transaction context
  mutate(callback: () => void): Transaction<T>

  // Commit -- calls mutationFn, transitions to persisting -> completed|failed
  commit(): Promise<Transaction<T>>

  // Rollback -- transitions to failed, also rolls back conflicting transactions
  rollback(config?: { isSecondaryRollback?: boolean }): Transaction<T>
}
```

**Lifecycle:** `pending` -> `persisting` -> `completed` | `failed`

- `mutate()` only allowed in `pending` state (throws `TransactionNotPendingMutateError`)
- `commit()` only allowed in `pending` state (throws `TransactionNotPendingCommitError`)
- `rollback()` allowed in `pending` or `persisting` (throws `TransactionAlreadyCompletedRollbackError` if completed)
- Failed `mutationFn` automatically triggers `rollback()`
- Rollback cascades to other pending transactions sharing the same item keys
- An empty or fully cancelled transaction completes without calling `mutationFn`

## PendingMutation Type

```ts
interface PendingMutation<T, TOperation = 'insert' | 'update' | 'delete'> {
  mutationId: string // unique id for this mutation
  original: TOperation extends 'insert' ? {} : T // state before mutation
  modified: T // state after mutation
  changes: Partial<T> // only the changed fields
  key: any // collection-local key
  globalKey: string // globally unique key (collectionId + key)
  type: TOperation // "insert" | "update" | "delete"
  metadata: unknown // user-provided metadata
  syncMetadata: Record<string, unknown> // adapter-specific metadata
  optimistic: boolean // whether applied optimistically (default true)
  createdAt: Date
  updatedAt: Date
  collection: Collection // reference to the source collection
}
```

## Mutation Merging Rules

When multiple mutations target the same item (same `globalKey`) within a
transaction, they merge:

| Existing | Incoming | Result    | Notes                              |
| -------- | -------- | --------- | ---------------------------------- |
| insert   | update   | insert    | Merge changes, keep empty original |
| insert   | delete   | _removed_ | Both mutations cancel out          |
| update   | update   | update    | Union changes, keep first original |
| update   | delete   | delete    | Delete dominates                   |
| delete   | delete   | delete    | Replace with latest                |
| insert   | insert   | insert    | Replace with latest                |

`(delete, update)` and `(delete, insert)` cannot occur -- the collection
prevents operations on deleted items within the same transaction.

## getActiveTransaction / Ambient Transaction Context

```ts
import { getActiveTransaction } from '@tanstack/db'

const tx = getActiveTransaction() // Transaction | undefined
```

Inside `tx.mutate(() => { ... })`, the transaction is pushed onto an internal
stack. Any `collection.insert/update/delete` call automatically joins the
topmost ambient transaction. This is how `createOptimisticAction` and
`createPacedMutations` wire collection operations into their transactions.

The ambient scope lasts only for the synchronous `mutate()` callback. A
collection operation after an `await` does not join that transaction. Put async
work in `mutationFn`, or call `mutate()` again while the transaction is still
pending.

## createOptimisticAction

```ts
import { createOptimisticAction } from "@tanstack/db"

const action = createOptimisticAction<TVariables>({
  // Synchronous -- apply optimistic state immediately (MUST NOT return a Promise)
  onMutate: (variables: TVariables) => void,

  // Async -- persist to backend, wait for sync back
  mutationFn: (variables: TVariables, params: { transaction }) => Promise<any>,

  // Optional: same as createTransaction config
  id?: string,
  autoCommit?: boolean,    // default true; false requires manual commit()
  metadata?: Record<string, unknown>,
})

// Returns a function: (variables: TVariables) => Transaction
const tx = action(variables)
await tx.isPersisted.promise
```

## createPacedMutations

```ts
import { createPacedMutations } from "@tanstack/db"

const mutate = createPacedMutations<TVariables>({
  onMutate: (variables: TVariables) => void,   // synchronous optimistic update
  mutationFn: MutationFn,                       // persists merged transaction
  strategy: Strategy,                            // timing control
  metadata?: Record<string, unknown>,
})

// Returns a function: (variables: TVariables) => Transaction
const tx = mutate(variables)
```

Rapid calls merge into the active transaction (via `applyMutations`) until the
strategy fires the commit. A new transaction is created for subsequent calls.

## Strategy Types

### debounceStrategy

```ts
import { debounceStrategy } from "@tanstack/db"

debounceStrategy({
  wait: number,           // ms to wait after last call before committing
  leading?: boolean,      // execute on the leading edge (default false)
  trailing?: boolean,     // execute on the trailing edge (default true)
})
```

### throttleStrategy

```ts
import { throttleStrategy } from "@tanstack/db"

throttleStrategy({
  wait: number,           // minimum ms between commits
  leading?: boolean,      // execute on the leading edge
  trailing?: boolean,     // execute on the trailing edge
})
```

### queueStrategy

```ts
import { queueStrategy } from "@tanstack/db"

queueStrategy({
  wait?: number,                      // ms between processing items (default 0)
  maxSize?: number,                   // drop items if queue exceeds this
  addItemsTo?: "front" | "back",     // default "back" (FIFO)
  getItemsFrom?: "front" | "back",   // default "front" (FIFO)
})
```

Queue creates a **separate transaction per call** (unlike debounce/throttle
which merge). Each transaction commits and awaits `isPersisted` before the next
starts. Failed transactions do not block subsequent ones.

## Transaction.isPersisted.promise

```ts
const tx = collection.insert({ id: '1', text: 'Hello' })

try {
  await tx.isPersisted.promise // resolves with the Transaction on success
  console.log(tx.state) // "completed"
} catch (error) {
  console.log(tx.state) // "failed"
  // optimistic state has been rolled back
}
```

The promise is a `Deferred` -- it is created at transaction construction time
and settled when `commit()` completes or `rollback()` is called. For
`autoCommit: true` transactions, commit starts after `mutate()` returns; the
promise can remain pending as long as `mutationFn` does.

For a non-empty commit, `mutationFn` is the normal success boundary.
`isPersisted.promise` does not by itself prove that a backend uploaded,
confirmed, or read back the write. It proves those stronger guarantees only
when `mutationFn` waits for them before returning.
