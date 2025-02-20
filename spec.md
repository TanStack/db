# Sync Library Technical Specification

## Overview
A general mutation library for sync engines that can write to any API. The library provides automatic optimistic updates, retry handling, and flexible mutation strategies for different types of updates.

## Core Concepts

### Collections
- Collections represent synchronized datasets that can be mutated locally and persisted to a backend
- Each collection is identified by its sync configuration
- Multiple components can share the same collection instance
- Collections maintain both synced state and optimistic updates

### Mutations
Two primary mutation strategies:
1. **Ordered** (default)
   - Mutations queue behind active transactions
   - Strict ordering of changes
   - Automatic rollback of dependent transactions
   
2. **Parallel**
   - All mutations can fire API calls immediately
   - Custom merge function to handle sync updates
   - Optimistic updates reapplied on top of incoming syncs
   - No queueing or dependency management

### Transactions
- Track the state and history of mutations
- Include retry attempts and error information
- Support both ordered and parallel mutation patterns
- Maintain full history of attempts and timing
- Automatically persist to survive page reloads
- All-or-nothing atomicity (no partial success)

## API Design

### Collection Hook
```typescript
const useCollection = (config: {
  sync: SyncConfig
  mutationFn?: MutationFn
}) => {
  return {
    data: Record<string, any>
    update: UpdateFn
    insert: InsertFn
    delete: DeleteFn
    withMutation: WithMutationFn
  }
}
```

### Sync Configuration
```typescript
type SyncConfig = {
  id: string
  setup: (params: { 
    onUpdate: (data: any) => void 
  }) => Promise<{
    data: any
  }>
}
```

### Mutation Function
```typescript
type MutationFn = {
  // Persist changes to backend
  persist: (params: {
    changes: Record<string, any>
    attempt: number
    transaction: Transaction
  }) => Promise<void>

  // Optional - await sync completion
  awaitSync?: (params: {
    changes: Record<string, any>
    transaction: Transaction
    sync: SyncInstance
  }) => Promise<void>
}
```

### Transaction State
```typescript
type TransactionState = 
  | 'queued'          // Waiting for another transaction to complete
  | 'pending'         // Created but not yet persisting
  | 'persisting'      // Currently running mutationFn.persist()
  | 'persisted_awaiting_sync'  // Persist succeeded, waiting for sync
  | 'completed'       // Fully completed
  | 'failed'          // Failed (includes dependency cancellations)

type Transaction = {
  id: string
  state: TransactionState
  created_at: Date
  updated_at: Date
  mutations: PendingMutation[]
  attempts: Attempt[]
  current_attempt: number
  queued_behind?: string
  error?: {
    transaction_id?: string  // For dependency failures
    message: string
    error: Error
  }
}

type Attempt = {
  id: string
  started_at: Date
  completed_at?: Date
  error?: Error
  retry_scheduled_for?: Date
}

type PendingMutation = {
  mutationId: string
  original: Record<string, any>
  modified: Record<string, any>
  changes: Record<string, any>
  metadata: unknown
  created_at: Date
  updated_at: Date
  state: 'created' | 'persisting' | 'synced'
}
```

### Mutation Strategy
```typescript
type MutationStrategy = {
  type: 'ordered' | 'parallel'
  merge?: (syncedData: any, pendingMutations: PendingMutation[]) => any
}
```

### Error Handling
```typescript
class NonRetriableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetriableError'
  }
}
```

### Lock Management
```typescript
// Helper function to determine locked objects from transaction state
function getLockedObjects(transactions: Transaction[]): Set<string> {
  return new Set(
    transactions
      .filter(t => 
        t.state === 'persisting' || 
        t.state === 'persisted_awaiting_sync'
      )
      .flatMap(t => t.mutations)
      .map(m => m.modified.id)
  )
}
```

## Implementation Details

### Transaction Persistence
- All transactions automatically persist to survive page reloads
- Uses IndexedDB by default
- Logs error if persistence setup fails
- Recovers and retries pending transactions on page load
- Assumes successful sync if page closed after persist succeeds

### Retry Handling
- Retry by default for all errors
- NonRetriableError to opt out of retries
- Default 4 retries (5 total attempts) per transaction
- Exponential backoff with configurable options

### Optimistic Updates
- Applied immediately upon mutation
- Maintained until backend sync completes
- For parallel mutations, reapplied after syncs via merge function
- For ordered mutations, queued behind active transactions
- Dropped after successful persist if page reloads before sync completes

### Sync Integration
- Sync mechanism provided by developer
- Updates to locked objects queue until transaction completes
- Parallel mutations use merge function to handle concurrent updates
- Sync instance passed to mutationFn for coordination

### Transaction Management
1. Ordered Transactions:
   - Lock detection via transaction state
   - Queue dependent mutations
   - Roll back on failure
   - Release locks after sync

2. Parallel Transactions:
   - No locking or queueing
   - Independent API calls
   - Simple merge strategy
   - No rollback on failure

### State Management
- Track all transactions with full history
- Maintain optimistic updates separately
- Queue updates to locked objects
- Expose transaction state for monitoring
- No automatic pruning of transaction history

## Extension Points

The library provides several key extension points for advanced functionality:

### Error Handling
- Custom retry strategies
- Extended error classification beyond NonRetriableError
- Error transformation and aggregation

### Merge Strategies
- Custom merge functions for parallel mutations
- Advanced conflict resolution
- Domain-specific merge logic

### Monitoring
- Transaction event subscribers
- Custom logging and metrics
- Debug tooling and visualization
- Performance monitoring

## Testing Utilities

### Basic Test Harness
```typescript
const { collection, syncControl } = createTestCollection({
  initialData: any
  sync: SyncConfig
})

// Control sync behavior
syncControl.emitUpdate(data)
syncControl.setNetworkDelay(ms)
syncControl.failNextPersist()
```

### Future Testing Enhancements
- Network condition simulation
- Persistence recovery testing
- Parallel/ordered mutation interaction testing
- Transaction state inspection
- Time-travel debugging

## State Exposure
- All transaction state available via useTransactions hook
- Support for building debugging tools
- Event subscription for state changes

## Future Considerations
- SSR support via Provider pattern
- RSC support via HydrationBoundary
- Advanced debugging tools
- Extended test utilities
- Transaction history pruning
- Advanced merge conflict resolution
- Performance optimizations for large datasets
