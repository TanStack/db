# @tanstack/offline-transactions

Offline-first transaction capabilities for TanStack DB that provides durable persistence of mutations with automatic retry when connectivity is restored.

## Features

- **Outbox Pattern**: Persist mutations before dispatch for zero data loss
- **Automatic Retry**: Configurable retry behavior with exponential backoff + jitter by default
- **Multi-tab Coordination**: Leader election ensures safe storage access
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

The React Native implementation requires the `@react-native-community/netinfo` peer dependency for network connectivity detection.

## Platform Support

This package provides platform-specific implementations for web and React Native environments:

- **Web**: Uses browser APIs (`window.online/offline` events, `document.visibilitychange`)
- **React Native**: Uses React Native primitives (`@react-native-community/netinfo` for network status, `AppState` for foreground/background detection)

## Quick Start

Using offline transactions on web and React Native/Expo is identical except for the import. Choose the appropriate import based on your target platform:

**Web:**

```typescript
import { startOfflineExecutor } from '@tanstack/offline-transactions'
```

**React Native / Expo:**

```typescript
import { startOfflineExecutor } from '@tanstack/offline-transactions/react-native'
```

**Usage (same for both platforms):**

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

// Create offline transactions
const offlineTx = offline.createOfflineTransaction({
  mutationFnName: 'syncTodos',
  autoCommit: false,
})

offlineTx.mutate(() => {
  todoCollection.insert({
    id: crypto.randomUUID(),
    text: 'Buy milk',
    completed: false,
  })
})

// Execute with automatic offline support
await offlineTx.commit()
```

## Core Concepts

### Outbox-First Persistence

Mutations are persisted to a durable outbox before being applied, ensuring zero data loss during offline periods:

1. Mutation is persisted to IndexedDB/localStorage
2. Optimistic update is applied locally
3. When online, mutation is sent to server
4. On success, mutation is removed from outbox

### Multi-tab Coordination

Only one tab acts as the "leader" to safely manage the outbox:

- **Leader tab**: Full offline support with outbox persistence
- **Non-leader tabs**: Online-only mode for safety
- **Leadership transfer**: Automatic failover when leader tab closes

### FIFO Sequential Processing

Transactions are processed one at a time in the order they were created:

- **Sequential execution**: All transactions execute in FIFO order
- **Dependency safety**: Avoids conflicts between transactions that may reference each other
- **Predictable behavior**: Transactions complete in the exact order they were created

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
  beforeRetry?: (transactions: OfflineTransaction[]) => OfflineTransaction[]
  onUnknownMutationFn?: (name: string, tx: OfflineTransaction) => void
  onLeadershipChange?: (isLeader: boolean) => void
  onlineDetector?: OnlineDetector
}
```

### OfflineExecutor

#### Properties

- `isOfflineEnabled: boolean` - Whether this tab can persist offline transactions

#### Methods

- `createOfflineTransaction(options)` - Create a manual offline transaction
- `waitForTransactionCompletion(id)` - Wait for a specific transaction to complete
- `removeFromOutbox(id)` - Manually remove transaction from outbox
- `peekOutbox()` - View all pending transactions
- `dispose()` - Clean up resources

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
`mutationFn` returned and the executor removed the transaction from its durable
outbox. It means the server confirmed or exposed the write only when that
`mutationFn` explicitly waits for the provider's acknowledgement, read-back, or
sync observation before returning.

```typescript
const offlineTx = offline.createOfflineTransaction({
  mutationFnName: 'syncTodos',
  autoCommit: false,
})

const tx = offlineTx.mutate(() => {
  todoCollection.insert({ id: '1', text: 'Buy milk', completed: false })
})

console.log(tx.state) // 'pending'

void offlineTx.commit().catch((error) => {
  showSubmissionError(error)
})

await tx.isPersisted.promise
console.log(tx.state) // 'completed'
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
handler is unsafe because it can erase a newer transaction's status. A map that
represents only "the latest submission" must identity-check its cleanup:

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
permanent failure, removes the outbox entry, and rolls back its optimistic
state.

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

const tx = offline.createOfflineTransaction({ mutationFnName: 'syncTodos' })
tx.mutate(() => todoCollection.insert({ id: '1', text: 'Buy milk' }))
await tx.commit() // Works offline!
```

## Platform Support

### Web Browsers

- **IndexedDB**: Modern browsers (primary storage)
- **localStorage**: Fallback for limited environments
- **Web Locks API**: Chrome 69+, Firefox 96+ (preferred leader election)
- **BroadcastChannel**: All modern browsers (fallback leader election)

### React Native

- **React Native**: 0.60+ (tested with latest versions)
- **Expo**: SDK 40+ (tested with latest versions)
- **Required peer dependency**: `@react-native-community/netinfo` for network connectivity detection
- **Storage**: Uses AsyncStorage or custom storage adapters

## License

MIT
