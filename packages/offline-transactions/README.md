# @tanstack/offline-transactions

Offline-first transaction capabilities for TanStack DB that provides durable persistence of mutations with automatic retry when connectivity is restored.

## Features

- **Outbox Pattern**: Persist mutations before dispatch for zero data loss
- **Automatic Retry**: Exponential backoff with jitter for failed transactions
- **Multi-tab Coordination**: Leader election ensures safe storage access
- **Key-based Scheduling**: Parallel execution across distinct keys, sequential per key
- **Flexible Storage**: IndexedDB with localStorage fallback
- **Type Safe**: Full TypeScript support with TanStack DB integration

## Installation

```bash
npm install @tanstack/offline-transactions
```

## Quick Start

```typescript
import { startOfflineExecutor } from '@tanstack/offline-transactions'

// Setup offline executor
const offline = startOfflineExecutor({
  collections: { todos: todoCollection },
  mutationFns: {
    syncTodos: async ({ transaction, idempotencyKey }) => {
      await api.saveBatch(transaction.mutations, { idempotencyKey })
    }
  },
  onLeadershipChange: (isLeader) => {
    if (!isLeader) {
      console.warn('Running in online-only mode (another tab is the leader)')
    }
  }
})

// Use offline actions
const addTodo = offline.createOfflineAction({
  mutationFnName: 'syncTodos',
  onMutate: (text: string) => {
    todoCollection.insert({
      id: crypto.randomUUID(),
      text,
      completed: false
    })
  }
})

// Execute with automatic offline support
addTodo('Buy milk')
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

### Key-based Scheduling

Transactions are scheduled based on the keys they modify:

- **Parallel execution**: Transactions affecting different keys run concurrently
- **Sequential execution**: Transactions affecting the same keys run in order
- **Configurable concurrency**: Control maximum parallel transactions

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
- `createOfflineAction<T>(options)` - Create an optimistic action function
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
import { IndexedDBAdapter, LocalStorageAdapter } from '@tanstack/offline-transactions'

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
    const cutoff = Date.now() - (24 * 60 * 60 * 1000) // 24 hours
    return transactions.filter(tx => tx.createdAt.getTime() > cutoff)
  },
  // ... other config
})
```

### Manual Transaction Control

```typescript
const tx = executor.createOfflineTransaction({
  mutationFnName: 'syncData',
  autoCommit: false
})

tx.mutate(() => {
  collection.insert({ id: '1', text: 'Item 1' })
  collection.insert({ id: '2', text: 'Item 2' })
})

// Commit when ready
await tx.commit()
```

## Migration from TanStack DB

Existing TanStack DB code works without changes:

```typescript
// Before: Standard TanStack DB
todoCollection.insert({ id: '1', text: 'Buy milk' })

// After: Same code, now with offline support
const offline = startOfflineExecutor({
  collections: { todos: todoCollection },
  mutationFns: { /* ... */ }
})

todoCollection.insert({ id: '1', text: 'Buy milk' }) // Now works offline!
```

## Browser Support

- **IndexedDB**: Modern browsers (primary storage)
- **localStorage**: Fallback for limited environments
- **Web Locks API**: Chrome 69+, Firefox 96+ (preferred leader election)
- **BroadcastChannel**: All modern browsers (fallback leader election)

## License

MIT