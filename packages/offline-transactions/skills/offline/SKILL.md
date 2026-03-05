---
name: offline
description: >
  Offline transaction support for TanStack DB. OfflineExecutor orchestrates
  persistent outbox (IndexedDB/localStorage), leader election (WebLocks/
  BroadcastChannel), retry with backoff, and connectivity detection.
  createOfflineTransaction/createOfflineAction wrap TanStack DB primitives
  with offline persistence. Idempotency keys for at-least-once delivery.
  Graceful degradation to online-only mode when storage unavailable.
  React Native support via separate entry point.
type: composition
library: db
library_version: '0.5.30'
requires:
  - db-core
  - db-core/mutations-optimistic
sources:
  - 'TanStack/db:packages/offline-transactions/src/OfflineExecutor.ts'
  - 'TanStack/db:packages/offline-transactions/src/types.ts'
  - 'TanStack/db:packages/offline-transactions/src/index.ts'
---

This skill builds on db-core and mutations-optimistic. Read those first.

# TanStack DB — Offline Transactions

## Setup

```ts
import {
  startOfflineExecutor,
  IndexedDBAdapter,
} from '@tanstack/offline-transactions'
import { todoCollection } from './collections'

const executor = startOfflineExecutor({
  collections: { todos: todoCollection },
  mutationFns: {
    createTodo: async ({ transaction, idempotencyKey }) => {
      const mutation = transaction.mutations[0]
      await api.todos.create({
        ...mutation.modified,
        idempotencyKey,
      })
    },
    updateTodo: async ({ transaction, idempotencyKey }) => {
      const mutation = transaction.mutations[0]
      await api.todos.update(mutation.key, {
        ...mutation.changes,
        idempotencyKey,
      })
    },
  },
})

// Wait for initialization (storage probe, leader election, outbox replay)
await executor.waitForInit()
```

## Core API

### createOfflineTransaction

```ts
const tx = executor.createOfflineTransaction({
  mutationFnName: 'createTodo',
})

// Mutations run inside tx.mutate() — uses ambient transaction context
tx.mutate(() => {
  todoCollection.insert({ id: crypto.randomUUID(), text: 'New todo' })
})
tx.commit()
```

If the executor is not the leader tab, falls back to `createTransaction` directly (no offline persistence).

### createOfflineAction

```ts
const addTodo = executor.createOfflineAction({
  mutationFnName: 'createTodo',
  onMutate: (variables) => {
    todoCollection.insert({
      id: crypto.randomUUID(),
      text: variables.text,
    })
  },
})

// Call it
addTodo({ text: 'Buy milk' })
```

If the executor is not the leader tab, falls back to `createOptimisticAction` directly.

## Architecture

### Components

| Component               | Purpose                                     | Default                           |
| ----------------------- | ------------------------------------------- | --------------------------------- |
| **Storage**             | Persist transactions to survive page reload | IndexedDB → localStorage fallback |
| **OutboxManager**       | FIFO queue of pending transactions          | Automatic                         |
| **KeyScheduler**        | Serialize transactions touching same keys   | Automatic                         |
| **TransactionExecutor** | Execute with retry + backoff                | Automatic                         |
| **LeaderElection**      | Only one tab processes the outbox           | WebLocks → BroadcastChannel       |
| **OnlineDetector**      | Pause/resume on connectivity changes        | navigator.onLine + events         |

### Transaction lifecycle

1. Mutation applied optimistically to collection (instant UI update)
2. Transaction serialized and persisted to storage (outbox)
3. Leader tab picks up transaction and executes `mutationFn`
4. On success: removed from outbox, optimistic state resolved
5. On failure: retried with exponential backoff
6. On page reload: outbox replayed, optimistic state restored

### Leader election

Only one tab processes the outbox to prevent duplicate execution. Non-leader tabs use regular `createTransaction`/`createOptimisticAction` (online-only, no persistence).

```ts
const executor = startOfflineExecutor({
  // ...
  onLeadershipChange: (isLeader) => {
    console.log(
      isLeader
        ? 'This tab is processing offline transactions'
        : 'Another tab is leader',
    )
  },
})

executor.isOfflineEnabled // true only if leader AND storage available
```

### Storage degradation

The executor probes storage availability on startup:

```ts
const executor = startOfflineExecutor({
  // ...
  onStorageFailure: (diagnostic) => {
    // diagnostic.code: 'STORAGE_BLOCKED' | 'QUOTA_EXCEEDED' | 'UNKNOWN_ERROR'
    // diagnostic.mode: 'online-only'
    console.warn(diagnostic.message)
  },
})

executor.mode // 'offline' | 'online-only'
executor.storageDiagnostic // Full diagnostic info
```

When storage is unavailable (private browsing, quota exceeded), the executor operates in online-only mode — mutations work normally but aren't persisted across page reloads.

## Configuration

```ts
interface OfflineConfig {
  collections: Record<string, Collection> // Collections for optimistic state restoration
  mutationFns: Record<string, OfflineMutationFn> // Named mutation functions
  storage?: StorageAdapter // Custom storage (default: auto-detect)
  maxConcurrency?: number // Parallel execution limit
  jitter?: boolean // Add jitter to retry delays
  beforeRetry?: (txs) => txs // Transform/filter before retry
  onUnknownMutationFn?: (name, tx) => void // Handle orphaned transactions
  onLeadershipChange?: (isLeader) => void // Leadership state callback
  onStorageFailure?: (diagnostic) => void // Storage probe failure callback
  leaderElection?: LeaderElection // Custom leader election
  onlineDetector?: OnlineDetector // Custom connectivity detection
}
```

### Custom storage adapter

```ts
interface StorageAdapter {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
  delete: (key: string) => Promise<void>
  keys: () => Promise<Array<string>>
  clear: () => Promise<void>
}
```

## Error Handling

### NonRetriableError

```ts
import { NonRetriableError } from '@tanstack/offline-transactions'

const executor = startOfflineExecutor({
  mutationFns: {
    createTodo: async ({ transaction, idempotencyKey }) => {
      const res = await fetch('/api/todos', { method: 'POST', body: ... })
      if (res.status === 409) {
        throw new NonRetriableError('Duplicate detected')
      }
      if (!res.ok) throw new Error('Server error')
    },
  },
})
```

Throwing `NonRetriableError` stops retry and removes the transaction from the outbox. Use for permanent failures (validation errors, conflicts, 4xx responses).

### Idempotency keys

Every offline transaction includes an `idempotencyKey`. Pass it to your API to prevent duplicate execution on retry:

```ts
mutationFns: {
  createTodo: async ({ transaction, idempotencyKey }) => {
    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(transaction.mutations[0].modified),
    })
  },
}
```

## React Native

```ts
import {
  startOfflineExecutor,
} from '@tanstack/offline-transactions/react-native'

// Uses ReactNativeOnlineDetector automatically
// Uses AsyncStorage-compatible storage
const executor = startOfflineExecutor({ ... })
```

## Outbox Management

```ts
// Inspect pending transactions
const pending = await executor.peekOutbox()

// Get counts
executor.getPendingCount() // Queued transactions
executor.getRunningCount() // Currently executing

// Clear all pending transactions
await executor.clearOutbox()

// Cleanup
executor.dispose()
```

## Common Mistakes

### CRITICAL Not passing idempotencyKey to the API

Wrong:

```ts
mutationFns: {
  createTodo: async ({ transaction }) => {
    await api.todos.create(transaction.mutations[0].modified)
  },
}
```

Correct:

```ts
mutationFns: {
  createTodo: async ({ transaction, idempotencyKey }) => {
    await api.todos.create({
      ...transaction.mutations[0].modified,
      idempotencyKey,
    })
  },
}
```

Offline transactions retry on failure. Without idempotency keys, retries can create duplicate records on the server.

### HIGH Not waiting for initialization

Wrong:

```ts
const executor = startOfflineExecutor({ ... })
const tx = executor.createOfflineTransaction({ mutationFnName: 'createTodo' })
```

Correct:

```ts
const executor = startOfflineExecutor({ ... })
await executor.waitForInit()
const tx = executor.createOfflineTransaction({ mutationFnName: 'createTodo' })
```

`startOfflineExecutor` initializes asynchronously (probes storage, requests leadership, replays outbox). Creating transactions before initialization completes may miss the leader election result and use the wrong code path.

### HIGH Missing collection in collections map

Wrong:

```ts
const executor = startOfflineExecutor({
  collections: {},
  mutationFns: { createTodo: ... },
})
```

Correct:

```ts
const executor = startOfflineExecutor({
  collections: { todos: todoCollection },
  mutationFns: { createTodo: ... },
})
```

The `collections` map is used to restore optimistic state from the outbox on page reload. Without it, previously pending mutations won't show their optimistic state while being replayed.

### MEDIUM Not handling NonRetriableError for permanent failures

Wrong:

```ts
mutationFns: {
  createTodo: async ({ transaction }) => {
    const res = await fetch('/api/todos', { ... })
    if (!res.ok) throw new Error('Failed')
  },
}
```

Correct:

```ts
mutationFns: {
  createTodo: async ({ transaction }) => {
    const res = await fetch('/api/todos', { ... })
    if (res.status >= 400 && res.status < 500) {
      throw new NonRetriableError(`Client error: ${res.status}`)
    }
    if (!res.ok) throw new Error('Server error')
  },
}
```

Without distinguishing retriable from permanent errors, 4xx responses (validation, auth, not found) will retry forever until max retries, wasting resources and filling logs.

See also: db-core/mutations-optimistic/SKILL.md — for the underlying mutation primitives.

See also: db-core/collection-setup/SKILL.md — for setting up collections used with offline transactions.
