# @tanstack/offline-transactions

This package gives the leader a durable outbox for pending TanStack DB mutations. It retries stored mutations when the server is available. Read the [Offline Transactions guide](../../docs/guides/offline-transactions.md) for setup and lifecycle behavior.

## Features

- **Outbox**: The leader stores mutations before sending them when `isOfflineEnabled` is true
- **Automatic Retry**: Configurable retry behavior with exponential backoff + jitter by default
- **Multi-tab Coordination**: Leader election chooses one tab to process the outbox
- **FIFO Sequential Processing**: Transactions execute one at a time in creation order
- **Flexible Storage**: IndexedDB with localStorage fallback
- **Type Safe**: Full TypeScript support with TanStack DB integration

## Installation

### Web

```bash
npm install @tanstack/offline-transactions
```

### React Native / Expo

```bash
npm install @tanstack/offline-transactions @react-native-community/netinfo
```

The React Native entry point uses `@react-native-community/netinfo` for connectivity detection. Supply a `StorageAdapter` for the outbox. The package does not include an AsyncStorage adapter.

## Platform Support

This package provides platform-specific implementations for web and React Native environments:

- **Web**: Uses browser APIs (`window.online` and `document.visibilitychange` events). Visible tabs let the executor process the outbox even when `navigator.onLine` is false; hidden tabs follow that hint. Errors from named mutation functions still use the retry decision and backoff. Visibility is local to each tab and does not transfer leadership from a hidden tab.
- **React Native**: Uses React Native primitives (`@react-native-community/netinfo` for network status, `AppState` for foreground/background detection)

## Quick Start

Use the entry point for your platform. React Native also needs a storage adapter, as shown in the [guide](../../docs/guides/offline-transactions.md#react-native-and-expo).

**Web:**

```typescript
import { startOfflineExecutor } from '@tanstack/offline-transactions'
```

**React Native / Expo:**

```typescript
import { startOfflineExecutor } from '@tanstack/offline-transactions/react-native'
```

**Web usage:**

```typescript
// Setup offline executor
const offline = startOfflineExecutor({
  collections: { todos: todoCollection },
  mutationFns: {
    syncTodos: async ({ transaction, idempotencyKey }) => {
      await api.saveBatch(transaction.mutations, { idempotencyKey })
    },
  },
  onLeadershipChange: (isLeader) => {
    if (!isLeader) {
      console.warn('Running in online-only mode (another tab is the leader)')
    }
  },
})

await offline.waitForInit()

// Create offline transactions
const offlineTx = offline.createOfflineTransaction({
  mutationFnName: 'syncTodos',
  autoCommit: false,
})

const transaction = offlineTx.mutate(() => {
  todoCollection.insert({
    id: crypto.randomUUID(),
    text: 'Buy milk',
    completed: false,
  })
})

// Commit can remain pending while offline. Observe final failure.
void offlineTx.commit().catch((error) => console.error(error))
void transaction.isPersisted.promise.catch((error) => console.error(error))
```

On React Native, pass a custom `storage` adapter to `startOfflineExecutor`.

## Core Concepts

### Durable Outbox

When `isOfflineEnabled` is true, the executor records a mutation before it sends the mutation to the server. The optimistic change appears before the outbox write settles:

1. The Collection applies an optimistic mutation.
2. The leader writes the transaction to the outbox.
3. When online, the executor calls the named mutation function.
4. After a successful call, the executor attempts to remove the outbox entry.

An optimistic change does not prove that the outbox write succeeded. Handle transaction failures, and use an idempotency key on the server because an attempt can run more than once.

### Multi-tab Coordination

Only one tab acts as the "leader" to safely manage the outbox:

- **Leader tab**: Full offline support with outbox persistence
- **Non-leader tabs**: Online-only mode for safety
- **Leadership transfer**: Automatic failover when leader tab closes

### FIFO Sequential Processing

The executor processes one transaction at a time, in creation order:

- **Sequential execution**: All transactions execute in FIFO order
- **Dependency safety**: Avoids conflicts between transactions that may reference each other
- **Predictable behavior**: Transactions complete in creation order

## API Reference

### startOfflineExecutor(config)

Creates and starts an offline executor instance.

```typescript
interface OfflineConfig {
  collections: Record<string, Collection>
  mutationFns: Record<string, MutationFn>
  storage?: StorageAdapter
  maxConcurrency?: number
  jitter?: boolean
  shouldRetry?: (error: Error, retryCount: number) => boolean | undefined
  beforeRetry?: (transactions: OfflineTransaction[]) => OfflineTransaction[]
  onUnknownMutationFn?: (name: string, tx: OfflineTransaction) => void
  onLeadershipChange?: (isLeader: boolean) => void
  onlineDetector?: OnlineDetector
}
```

### Retry decisions

`shouldRetry` receives the named mutation function's `Error` and the current
retry count, which is `0` on the first failure. The same `Error` instance is
passed through; a rejection with a non-`Error` value is converted to an `Error`
and may lose custom fields. Return `true` to retry, `false` to remove the
offline transaction from the outbox and reject its
waiting promises with that error, or `undefined` to use the default
decision. The hook is synchronous and shared by all named mutation functions.
An async hook returns a Promise, which fails its outbox row. Put any
function-specific context needed by the hook on the thrown error. For example,
this allows a 401 retry while keeping the default decision for other errors.
The named mutation function must throw an error that retains the HTTP response
status:

```typescript
import {
  NonRetriableError,
  startOfflineExecutor,
} from '@tanstack/offline-transactions'

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
    this.name = 'HttpError'
  }
}

const offline = startOfflineExecutor({
  collections: { todos: todoCollection },
  mutationFns: {
    syncTodos: async ({ transaction, idempotencyKey }) => {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(transaction.mutations),
      })
      // This todo API treats these responses as permanent. Classify other
      // statuses according to the server contract.
      if ([404, 405, 409, 410, 422].includes(response.status)) {
        throw new NonRetriableError(`Todo request rejected: ${response.status}`)
      }
      if (!response.ok) throw new HttpError(response.status)
    },
  },
  shouldRetry: (error) =>
    error instanceof HttpError && error.status === 401 ? true : undefined,
})
```

A retried transaction retains its FIFO position, so use this when the
authentication problem can recover. The app must refresh credentials separately
before another attempt.

`NonRetriableError` always stops retry without calling the hook. The default
policy still determines backoff and the `jitter` option. A hook that throws or
returns another value records a terminal rejection for that row, removes it
from the outbox, and rejects its waiting promises with the hook failure. Once
the deletion is acknowledged, queued rows continue in creation order. New
commits may join the queue during cleanup, but cannot run ahead of the failed
row's deletion. The named mutation function error is logged; the hook failure
is the caller-facing and stored error. A fresh executor does not replay the
failed row. Stored errors retain `name`, `message`, and `stack`, but a restart
does not restore an arbitrary error subclass or its custom fields.
If terminal marker storage or deletion fails, the caller still rejects with
the hook failure and the executor batch rejects with the storage error. The
executor then stops with queued work retained. A marked row skips the named
mutation function after restart; an unmarked row may replay.

### OfflineExecutor

#### Properties

- `isOfflineEnabled: boolean` - Whether this tab can persist offline transactions

#### Methods

- `createOfflineTransaction(options)` - Create a manual offline transaction
- `waitForTransactionCompletion(id)` - Wait for a specific transaction to complete
- `removeFromOutbox(id)` - Manually remove transaction from outbox
- `peekOutbox()` - View all pending transactions
- `dispose()` - Clean up resources

An acknowledged `removeFromOutbox(id)` or `clearOutbox()` while a named
mutation function is running does not cancel that call. If the call later
fails, its waiting promises reject with the named mutation function error; the
removed row is not retried.

### Error Handling

Use `NonRetriableError` for permanent failures:

```typescript
import { NonRetriableError } from '@tanstack/offline-transactions'

const mutationFn = async ({ transaction }) => {
  try {
    await api.save(transaction.mutations)
  } catch (error) {
    if (error.status === 422) {
      throw new NonRetriableError('Invalid data - will not retry')
    }
    throw error // Will retry with backoff
  }
}
```

## Advanced Usage

### Custom Storage Adapter

```typescript
import {
  IndexedDBAdapter,
  LocalStorageAdapter,
} from '@tanstack/offline-transactions'

const executor = startOfflineExecutor({
  // Use custom storage
  storage: new IndexedDBAdapter('my-app', 'transactions'),
  // ... other config
})
```

### Manual Transaction Control

```typescript
const tx = executor.createOfflineTransaction({
  mutationFnName: 'syncData',
  autoCommit: false,
})

tx.mutate(() => {
  collection.insert({ id: '1', text: 'Item 1' })
  collection.insert({ id: '2', text: 'Item 2' })
})

// Commit when ready
await tx.commit()
```

## Tracking Submission Status

The `Transaction` returned by `mutate()` exposes local transaction state. Its
`state` starts as `pending`, becomes `persisting` during commit, and settles as
`completed` or `failed`. A rollback can move it to `failed` before or during
persistence. `isPersisted.promise` settles at the same success or failure
boundary.

On the offline-execution path, successful settlement means the configured
`mutationFn` returned and the storage adapter acknowledged outbox deletion.
It means the server confirmed or exposed the write only when that
`mutationFn` explicitly waits for the provider's acknowledgement, read-back, or
sync observation before returning.

After `mutationFn` returns, the executor records a `deletion-pending` outbox
phase before removing the row. If recording that phase or removing the row
fails, `commit()`, `isPersisted.promise`, and the per-ID completion waiter reject
with the storage error. The executor stops: it does not retry the deletion,
process queued peers, or admit new transactions. A fresh executor can remove a
marked row without calling `mutationFn` again; `beforeRetry` only filters rows
whose provider work is still pending. An unmarked row can replay after a crash
or a failed phase write, so providers must honor the supplied `idempotencyKey`.
Outbox removal means the storage adapter acknowledged deletion; it does not
establish physical power-loss durability or exactly-once provider execution.
If an app removes a row during an active provider call, that caller still waits
for the provider call to return before it settles.

After a permanent provider failure, the caller rejects with that provider
error. The executor records a `rejection-pending` outbox phase before removing
the row. If the phase write or deletion fails, the executor batch throws the
storage error and stops with queued peers untouched. A fresh executor skips
provider work and optimistic restoration for a marked row. If writing the
marker failed, the unmarked row may replay after restart.

```typescript
const offlineTx = offline.createOfflineTransaction({
  mutationFnName: 'syncTodos',
  autoCommit: false,
})

const tx = offlineTx.mutate(() => {
  todoCollection.insert({ id: '1', text: 'Buy milk', completed: false })
})

console.log(tx.state) // 'pending'

try {
  await Promise.all([offlineTx.commit(), tx.isPersisted.promise])
  console.log(tx.state) // 'completed'
} catch (error) {
  showSubmissionError(error)
}
```

### Tracking Every Pending Transaction for an Item

An item can have more than one transaction in flight. Track transaction
identities rather than storing one replaceable boolean or deleting an
item-keyed entry unconditionally:

```typescript
import type { Transaction } from '@tanstack/db'

const pendingByItem = new Map<string, Set<Transaction>>()

function trackPending(itemId: string, tx: Transaction) {
  const pending = pendingByItem.get(itemId) ?? new Set<Transaction>()
  pending.add(tx)
  pendingByItem.set(itemId, pending)

  const removeThisTransaction = () => {
    pending.delete(tx)
    if (pending.size === 0 && pendingByItem.get(itemId) === pending) {
      pendingByItem.delete(itemId)
    }
  }

  // Handle fulfillment and rejection so cleanup does not create another
  // rejected Promise chain.
  void tx.isPersisted.promise.then(removeThisTransaction, removeThisTransaction)
}

function isPending(itemId: string): boolean {
  return (pendingByItem.get(itemId)?.size ?? 0) > 0
}
```

Using only `pendingItems.delete(itemId)` in an older transaction's completion
handler is unsafe because it can remove a newer transaction's status. A map that
represents only "the latest submission" must compare the current entry with the finishing transaction before cleanup:

```typescript
if (latestByItem.get(itemId) === tx) {
  latestByItem.delete(itemId)
}
```

That latest-only map can still be empty while an older transaction is pending
if the newer transaction settles first. Use a set as above when the UI must
answer whether _any_ submission remains pending.

### Inspecting Offline Work

The executor exposes point-in-time scheduler counts and the durable outbox:

```typescript
// Scheduled entries. The pending count can include the currently running entry.
const pendingCount = offline.getPendingCount()
const runningCount = offline.getRunningCount()

// Durable entries, including retry metadata.
const outbox = await offline.peekOutbox()
for (const entry of outbox) {
  console.log(entry.id, entry.retryCount, entry.lastError)
}
```

These values describe local executor work, not backend confirmation. A normal
retriable error leaves the transaction queued. A `NonRetriableError` marks a
permanent failure, rejects the caller, and rolls back its optimistic state.
The outbox entry remains until storage acknowledges its removal.

## Migration from TanStack DB

This package uses explicit offline transactions to provide offline capabilities:

```typescript
// Before: Standard TanStack DB (online only)
todoCollection.insert({ id: '1', text: 'Buy milk' })

// After: Explicit offline transactions
const offline = startOfflineExecutor({
  collections: { todos: todoCollection },
  mutationFns: {
    syncTodos: async ({ transaction }) => {
      await api.sync(transaction.mutations)
    },
  },
})

await offline.waitForInit()

const tx = offline.createOfflineTransaction({
  mutationFnName: 'syncTodos',
  autoCommit: false,
})
tx.mutate(() => todoCollection.insert({ id: '1', text: 'Buy milk' }))
await tx.commit() // Waits for the mutation function and outbox deletion.
```

## Platform Support

### Web Browsers

- **IndexedDB**: Modern browsers (primary storage)
- **localStorage**: Fallback for limited environments
- **Web Locks API**: Chrome 69+, Firefox 96+ (preferred leader election)
- **BroadcastChannel**: All modern browsers (fallback leader election)

### React Native

- **React Native**: 0.70+ (package peer dependency)
- **Expo**: Use the React Native entry point
- **Required peer dependency**: `@react-native-community/netinfo` for network connectivity detection
- **Storage**: Supply a custom `StorageAdapter`, such as the [example AsyncStorage adapter](../../examples/react-native/offline-transactions/src/db/AsyncStorageAdapter.ts)

## License

MIT
