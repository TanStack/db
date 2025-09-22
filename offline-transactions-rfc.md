# RFC: Offline-First Transactions

*(Note: This RFC covers offline mutation persistence and retry - ensuring writes don't get lost when offline. This is distinct from offline data persistence, which involves caching/syncing read data for offline access.)*

## Summary

TanStack DB applications will persist all mutations to a durable outbox before dispatch, enabling automatic replay when connectivity is restored. The system provides per-key scheduling (parallel across distinct keys, sequential per key), exponential backoff with jitter, failure discrimination via NonRetriableError, and developer hooks for filtering and squashing operations. Optimistic state is restored on restart by replaying persisted transactions, ensuring users never lose work during offline periods.

## Background

TanStack DB provides reactive client store with collections, live queries, and optimistic mutations. Currently, when a transaction's mutation function fails, the optimistic state is rolled back and the operation is lost. Users must manually retry operations when connectivity returns.

The framework lacks built-in mechanisms for persisting failed transactions across application restarts, automatically retrying operations when connectivity is restored, or distinguishing between temporary failures (network issues) and permanent failures (validation errors).

Demand for offline-first capabilities spans field service applications, productivity tools, mobile applications, and local-first collaborative systems. Without first-class offline support, developers must either accept data loss during network failures or build complex custom persistence and retry logic outside of TanStack DB.

## Problem

Developers using TanStack DB cannot build reliable offline-first applications without significant custom code. This creates three critical problems:

**Data Loss During Network Failures**: When a transaction's mutation function fails due to network issues, the optimistic updates are rolled back and the user's changes are lost. Users must remember and manually re-enter their data when connectivity returns, leading to frustration and potential data inconsistencies.

**No Persistence Across Application Restarts**: If the application closes while offline (browser tab closed, mobile app backgrounded, device restarted), any pending operations are permanently lost. There is no mechanism to queue and retry these operations when the application restarts with connectivity.

**Inability to Distinguish Failure Types**: All errors are treated identically - whether it's a temporary network failure that should be retried or a permanent validation error that will never succeed. This leads to either wasted resources retrying operations that will always fail or premature abandonment of operations that would succeed with retry.

These problems make TanStack DB unsuitable for applications requiring reliable offline operation, forcing developers to either accept data loss or build complex workarounds outside the framework.

## Proposal

### Core Architecture

Implement an outbox-first persistence system where every offline transaction is stored to durable storage before dispatch. This builds on TanStack DB's existing transaction model by adding persistence and replay capabilities to the current `Transaction` class.

### Outbox Schema

Each outbox transaction extends the existing `Transaction` format:

```typescript
{
  id: string,                    // existing transaction ID
  mutatorName: string,           // registry key for offline replay
  mutations: PendingMutation[],  // existing transaction.mutations
  keys: string[],                // derived from all mutation globalKeys
  idempotencyKey: string,        // stable UUID for the entire transaction
  createdAt: Date,               // existing transaction.createdAt
  retryCount: number,            // number of retry attempts
  nextAttemptAt: number,         // next scheduled retry time
  lastError?: SerializedError,   // most recent error details
  metadata?: Record<string, any>, // existing transaction.metadata
  version: 1                     // schema version for future migrations
}
```

### Storage Adapter

The storage layer accepts JavaScript objects and handles serialization internally. Default implementation uses IndexedDB for browsers with fallback to localStorage. Storage quota exceeded errors are thrown to the application for handling.

### Intelligent Execution Scheduling

The executor implements per-key scheduling based on `PendingMutation.globalKey`:

- **Parallel execution**: Transactions with non-overlapping keys execute concurrently up to `maxConcurrency` (default 4)
- **Sequential execution**: Transactions with overlapping keys execute in creation order, blocked on failure
- **Key extraction**: Uses existing `globalKey` from mutations (format: `${collection.id}:${itemKey}`)
- **Fairness**: When hitting concurrency limits, oldest transactions execute first regardless of key

### Retry Policy

Implements infinite retry with exponential backoff:

- **Backoff schedule**: 1s → 2s → 4s → 8s → 16s → 32s → 60s (capped)
- **Jitter**: Randomization prevents thundering herd
- **Retry-After**: Honors server-provided backoff hints
- **Fresh timing**: Each retry batch recalculates timing; filtered transactions are permanently deleted

### Failure Discrimination

- **Default behavior**: All errors trigger retry with exponential backoff
- **NonRetriableError**: Transactions are immediately removed from storage and not retried
- **Future extensibility**: Error classification system can expand for additional error types

### Online Detection and Triggers

Retry execution triggers on:

- Application initialization
- `navigator.onLine` events
- Visibility API changes (tab focus/unfocus)
- Manual developer trigger via `notifyOnline()`
- Any successful transaction (signals connectivity restored)

### Developer Control Hooks

**beforeRetry Hook**: Called before each retry batch with `beforeRetry(transactions[])`. Can filter, transform, or squash transactions. Filtered transactions are permanently deleted from storage.

**Manual Management**: `removeFromOutbox(id)` for programmatic transaction removal. Optional `peekOutbox()` for diagnostics.

### Optimistic State Restoration

On application restart, persisted transactions replay through the existing transaction system by calling the normal collection operations (insert/update/delete) to restore optimistic UI state. This leverages the existing `PendingMutation` data structure.

### Multi-Tab Coordination

Only one executor runs per origin using:

- **Primary**: Web Locks API for modern browsers
- **Fallback**: BroadcastChannel leader election
- **Failover**: Bounded recovery time when leader tab becomes unresponsive

Leadership transitions handle edge cases gracefully, with delays acceptable for v1 implementation.

### API Design

**Executor Initialization with Mutator and Collection Registry**:
```typescript
const offline = startOfflineExecutor({
  collections: {
    todos: todoCollection,
    projects: projectCollection,
    // Register all collections that will be used in offline transactions
  },
  mutators: {
    syncTodos: async ({ transaction, idempotencyKey }) => {
      // Handle all mutations in the transaction together
      await api.saveBatch(transaction.mutations, { idempotencyKey })
    },
    updateProject: async ({ transaction, idempotencyKey }) => {
      // Handle project-related mutations 
      await api.updateProject(transaction.mutations, { idempotencyKey })
    },
  },
  maxConcurrency: 4,
  jitter: true,
  beforeRetry: (transactions) => transactions.filter(tx => tx.createdAt > Date.now() - DAY),
  storage: indexedDbAdapter(),
  onUnknownMutator: (name, transaction) => console.warn(`Unknown mutator: ${name}`),
})
```

**Offline Transaction Creation** (follows `createTransaction` pattern):
```typescript
const tx = offline.createOfflineTransaction({
  mutatorName: 'syncTodos',
  autoCommit: false, // optional, defaults to true
})

tx.mutate(() => {
  // Apply optimistic updates using existing collection APIs
  todoCollection.insert({ id: '123', text: 'Buy milk' })
  todoCollection.update('124', (draft) => { draft.completed = true })
  projectCollection.update('proj1', (draft) => { draft.todoCount += 1 })
})

await tx.commit() // if autoCommit is false
```

**Offline Action Creation** (follows `createOptimisticAction` pattern):
```typescript
const addTodo = offline.createOfflineAction({
  mutatorName: 'syncTodos',
  onMutate: (text: string) => {
    todoCollection.insert({
      id: crypto.randomUUID(),
      text,
      completed: false
    })
  }
})

// Usage - returns Transaction like createOptimisticAction
const transaction = addTodo('New Todo Item')
await transaction.isPersisted.promise
```

### Automatic Offline Support for Collection Operations

When collections are registered with the offline executor, their existing mutation APIs automatically gain offline capabilities:

**Transparent Offline Behavior**:
```typescript
// Existing collection mutation APIs work offline automatically
todoCollection.insert({ id: '123', text: 'Buy milk' })
todoCollection.update('124', draft => draft.completed = true)
todoCollection.delete('125')
```

**Behind the Scenes**:
- If `todoCollection` is registered in the collection registry, these calls automatically create offline transactions
- Uses the collection's registry key (`'todos'`) as the `mutatorName`
- During replay, the system groups mutations by type and calls the appropriate collection handlers (`onInsert`/`onUpdate`/`onDelete`)

**Explicit Transactions** (for custom mutators):
```typescript
// Only needed when using custom mutators that handle multiple collections
const tx = offline.createOfflineTransaction({
  mutatorName: 'syncTodos' // Custom mutator for complex operations
})
```

### Integration with Existing System

This builds directly on the existing transaction system:

- **Reuses `Transaction` class**: Extends rather than replaces current transaction model
- **Preserves `PendingMutation`**: Uses existing mutation data structure for persistence
- **Maintains optimistic updates**: Leverages existing optimistic state management
- **Zero-config offline**: Existing collection operations work offline when collections are registered
- **Progressive enhancement**: Developers can add explicit mutators for advanced use cases

## Definition of success

This proposal succeeds when developers can build reliable offline-first applications with TanStack DB without custom persistence logic. Success metrics include:

**Functional Requirements Met**:
- Failed transactions persist across application restarts with full mutation data intact
- Automatic retry system handles network failures with exponential backoff and intelligent scheduling
- NonRetriableError prevents infinite retry of permanent failures
- Per-key scheduling enables parallel execution while maintaining consistency
- Multi-tab coordination prevents duplicate retry execution

**Developer Experience Goals**:
- APIs follow existing TanStack DB patterns (`createTransaction`, `createOptimisticAction`)
- Minimal configuration required for basic offline functionality
- Clear upgrade path from existing transaction usage
- Comprehensive error handling and debugging capabilities

**Performance Targets**:
- Outbox operations add minimal overhead to normal transaction flow
- Parallel retry execution maximizes throughput when connectivity returns
- Storage operations remain responsive under typical offline workloads
- Memory usage scales reasonably with outbox size

**Reliability Standards**:
- Zero data loss during offline periods and application restarts
- Graceful handling of storage quota and corruption scenarios
- Predictable behavior during network transitions and multi-tab usage
- Clear failure modes with actionable error messages

The feature succeeds when developers can add offline capabilities to existing TanStack DB applications with minimal code changes while maintaining the framework's reactive performance characteristics.

## Comparison with Existing Solutions

| Dimension                     | **TanStack DB Offline Transactions** | **TanStack Query (persisted/paused mutations)** | **Redux-Offline (Outbox)** | **Replicache** |
| ----------------------------- | ------------------------------------ | ----------------------------------------------- | --------------------------- | -------------- |
| **Core model**                | Outbox-first (persist before dispatch); replay on init/online | Persist paused mutations; resume if default `mutationFn` available | Outbox; queue of actions flushed when online | Local-first DB; named **mutators** + args; server sync |
| **Mutation representation**   | `Transaction` with `PendingMutation[]` bound by mutator registry; no closures | Function ref + variables (functions not serializable → needs default fn) | Action object; app reducer handles effects | `mutatorName` + JSON args; deterministic; re-runnable |
| **Idempotency**               | Auto-generated **idempotencyKey** per transaction; optional usage | None built-in; app could implement | Not built-in; app concern | Strongly encouraged; assumption in design |
| **Parallelism / ordering**    | **Parallel across keys**, **serial per key**; derived from `globalKey` | Per-mutation; no key-aware scheduler | Serial unless you build custom middleware | Mutator stream; server-side ordering by version/lsn |
| **Keying**                    | Auto-derived from existing `PendingMutation.globalKey` | N/A (no per-key scheduler) | N/A | Per-doc / per-space keys; CRDT-friendly patterns |
| **Retry policy**              | Infinite, expo backoff + jitter, honors `Retry-After` | Retry via Query's mechanisms; limited backoff control | Configurable backoff | Client retries; server reconciliation |
| **Failure taxonomy (v1)**     | Retry by default; `NonRetriableError` drops transaction | App-defined | App-defined | App-defined conflicts; server wins after push/pull |
| **Optimistic on restart**     | **Yes**: replay transactions to restore UI state immediately | Partial via cache rehydrate, but no cross-reload optimistic replay | Usually app-specific; often no | Yes (local DB is source of truth) |
| **Multi-tab leader election** | **Yes**: Web Locks → BroadcastChannel fallback | No (each tab manages its own) | Usually no (you add it) | **Yes** (LeaderElection via broadcast-channel) |
| **Service Worker / BG Sync**  | **Out of scope v1** (can layer later) | N/A | Optional community patterns | N/A (not required) |
| **Storage**                   | IndexedDB/localStorage adapter; async | Persist Query cache + paused mutations (IndexedDB) | Redux store + storage (often IndexedDB) | IndexedDB (browser) + server |
| **Dev hooks**                 | `beforeRetry(transactions[])`, `removeFromOutbox`, optional `peekOutbox()` | Mutation lifecycle callbacks | Configurable offline/online/commit hooks | Custom mutators; pull/push hooks |
| **Conflict handling**         | App-defined (mutator layer + beforeRetry rewrite/squash) | App-defined per mutation | App-defined reducers | Built-in patterns (server authoritative; app merges) |
| **API shape**                 | `startOfflineExecutor({ mutators })`, `offline.createOfflineTransaction`, `offline.createOfflineAction` | `persistQueryClient` + mutation defaults | Higher-order store enhancer + config | `rep.mutate.<name>(args)`; server sync protocol |
| **Philosophy fit**            | Extend existing TanStack DB transactions with durable outbox semantics | Online-first; offline is a pause/resume convenience | Offline-capable apps with Redux | Full local-first collaboration model |
| **Integration with TanStack DB** | **Native**: extends existing `Transaction` and `PendingMutation` | External: would need custom integration layer | External: would need custom integration layer | External: would need custom integration layer |

## Key Differentiators

**vs TanStack Query**: TanStack DB Offline Transactions provides key-aware scheduling and true transaction persistence across restarts, rather than just pausing individual mutations. The integration is native since it extends the existing transaction system.

**vs Redux-Offline**: Built-in parallelism via automatic key derivation eliminates the need for custom middleware. The system integrates directly with TanStack DB's reactive collections and optimistic updates.

**vs Replicache**: Focused on write-path reliability rather than full local-first database replacement. Developers keep their existing backend architecture while gaining offline write resilience.

**Positioning**: *TanStack DB Offline Transactions* extends your existing TanStack DB transaction workflow with durable outbox semantics and intelligent retry scheduling. It doesn't replace your backend, conflict strategy, or sync engine - it makes your existing write path safe under flaky networks and app restarts, with minimal API surface area.
