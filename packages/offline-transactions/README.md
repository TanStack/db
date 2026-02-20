# @tanstack/offline-transactions

Offline-first transaction capabilities for TanStack DB that provides durable persistence of mutations with automatic retry when connectivity is restored.

## Features

- **Outbox Pattern**: Persist mutations before dispatch for zero data loss
- **Automatic Retry**: Exponential backoff with jitter for failed transactions
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

### Capacitor

```bash
npm install @tanstack/offline-transactions @capacitor/network @capacitor/preferences
```

The Capacitor implementation requires the `@capacitor/network` and `@capacitor/preferences` peer dependency for network connectivity detection.

## Platform Support

This package provides platform-specific implementations for web and React Native environments:

- **Web**: Uses browser APIs (`window.online/offline` events, `document.visibilitychange`)
- **React Native**: Uses React Native primitives (`@react-native-community/netinfo` for network status, `AppState` for foreground/background detection)
- **Capacitor**: Uses Capacitor primitives (`@capacitor/network` and `@capacitor/preferences`)

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

**Capacitor**

```typescript
import { startOfflineExecutor } from '@tanstack/offline-transactions/capacitor'
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
- `notifyOnline()` - Manually trigger retry execution
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

### Custom Retry Policy

```typescript
const executor = startOfflineExecutor({
  maxConcurrency: 5,
  jitter: true,
  beforeRetry: (transactions) => {
    // Filter out old transactions
    const cutoff = Date.now() - 24 * 60 * 60 * 1000 // 24 hours
    return transactions.filter((tx) => tx.createdAt.getTime() > cutoff)
  },
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

## Capacitor
- **Capacitor**: 8.0.0+ (tested with latest versions)
- **Required peer dependency**: `@capacitor/network` and `@capacitor/preferences` for network connectivity detection

## License

MIT
