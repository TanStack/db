# TanStack DB Offline Transactions Implementation Plan

## Overview
Implementation plan for the new `packages/offline-transactions` package that extends TanStack DB with offline-first transaction capabilities. This package will provide durable persistence of mutations with automatic retry when connectivity is restored.

## Package Structure

```
packages/offline-transactions/
├── src/
│   ├── index.ts                  # Main exports
│   ├── OfflineExecutor.ts        # Main entry point
│   ├── types.ts                  # Type definitions
│   ├── storage/
│   │   ├── StorageAdapter.ts     # Storage interface
│   │   ├── IndexedDBAdapter.ts   # Primary storage
│   │   └── LocalStorageAdapter.ts # Fallback storage
│   ├── outbox/
│   │   ├── OutboxManager.ts      # Transaction persistence
│   │   └── TransactionSerializer.ts # Serialization logic
│   ├── executor/
│   │   ├── TransactionExecutor.ts # Execution orchestration
│   │   └── KeyScheduler.ts       # Per-key scheduling
│   ├── retry/
│   │   ├── RetryPolicy.ts        # Retry configuration
│   │   ├── BackoffCalculator.ts  # Exponential backoff
│   │   └── NonRetriableError.ts  # Error classification
│   ├── connectivity/
│   │   └── OnlineDetector.ts     # Network monitoring
│   ├── coordination/
│   │   ├── LeaderElection.ts     # Multi-tab coordination
│   │   ├── WebLocksLeader.ts     # Web Locks implementation
│   │   └── BroadcastChannelLeader.ts # Fallback leader
│   ├── replay/
│   │   └── TransactionReplay.ts  # State restoration
│   └── api/
│       ├── OfflineTransaction.ts # Transaction API
│       └── OfflineAction.ts      # Action API
├── tests/
├── package.json
└── README.md
```

## Implementation Phases

### Phase 1: Core Infrastructure

#### 1.1 Package Setup
- Create new package at `packages/offline-transactions`
- Set up TypeScript configuration
- Add dependencies on `@tanstack/db`
- Configure build tooling

#### 1.2 Type Definitions
```typescript
// types.ts
export interface OfflineTransaction {
  id: string
  mutationFnName: string
  mutations: PendingMutation[]
  keys: string[]
  idempotencyKey: string
  createdAt: Date
  retryCount: number
  nextAttemptAt: number
  lastError?: SerializedError
  metadata?: Record<string, any>
  version: 1
}

export interface OfflineConfig {
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

#### 1.3 Storage Layer
- Implement `StorageAdapter` interface
- Create `IndexedDBAdapter` with async operations
- Create `LocalStorageAdapter` as fallback
- Handle quota exceeded errors gracefully
- Add serialization for `PendingMutation` objects

### Phase 2: Outbox Management

#### 2.1 OutboxManager
```typescript
class OutboxManager {
  constructor(private storage: StorageAdapter) {}
  
  async add(transaction: OfflineTransaction): Promise<void>
  async get(id: string): Promise<OfflineTransaction | null>
  async getAll(): Promise<OfflineTransaction[]>
  async getByKeys(keys: string[]): Promise<OfflineTransaction[]>
  async update(id: string, updates: Partial<OfflineTransaction>): Promise<void>
  async remove(id: string): Promise<void>
  async removeMany(ids: string[]): Promise<void>
}
```

#### 2.2 Transaction Serialization
- Handle circular references in collections
- Preserve mutation data structure
- Support schema versioning for migrations

### Phase 3: Execution Engine

#### 3.1 KeyScheduler
```typescript
class KeyScheduler {
  private keyQueues: Map<string, OfflineTransaction[]>
  private runningKeys: Set<string>
  
  schedule(transaction: OfflineTransaction): void
  getNextBatch(maxConcurrency: number): OfflineTransaction[]
  markCompleted(transaction: OfflineTransaction): void
  markFailed(transaction: OfflineTransaction): void
}
```

Key scheduling algorithm:
1. Extract keys from each `PendingMutation.globalKey`
2. Group transactions by overlapping keys
3. Execute parallel for non-overlapping keys
4. Execute sequential for overlapping keys (FIFO)
5. Respect `maxConcurrency` limit

#### 3.2 TransactionExecutor
```typescript
class TransactionExecutor {
  constructor(
    private scheduler: KeyScheduler,
    private outbox: OutboxManager,
    private config: OfflineConfig
  ) {}
  
  async execute(transaction: OfflineTransaction): Promise<void>
  async executeAll(): Promise<void>
  private async runMutationFn(transaction: OfflineTransaction): Promise<void>
  private handleError(transaction: OfflineTransaction, error: Error): void
}
```

### Phase 4: Retry Logic

#### 4.1 Exponential Backoff
```typescript
class BackoffCalculator {
  calculate(retryCount: number): number {
    const baseDelay = Math.min(1000 * Math.pow(2, retryCount), 60000)
    const jitter = this.config.jitter ? Math.random() * 0.3 : 0
    return baseDelay * (1 + jitter)
  }
}
```

#### 4.2 Error Classification
```typescript
export class NonRetriableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetriableError'
  }
}
```

### Phase 5: Connectivity & Triggers

#### 5.1 OnlineDetector
```typescript
class OnlineDetector {
  private listeners: Set<() => void> = new Set()
  
  constructor() {
    // Listen to navigator.onLine
    // Listen to visibility API
    // Listen to successful transactions
  }
  
  subscribe(callback: () => void): () => void
  notifyOnline(): void
}
```

Triggers for retry execution:
- Application initialization
- `navigator.onLine` becomes true
- Tab becomes visible (visibility API)
- Manual `notifyOnline()` call
- Any successful transaction completion

### Phase 6: Multi-Tab Coordination

#### 6.1 Leader Election
```typescript
interface LeaderElection {
  requestLeadership(): Promise<boolean>
  releaseLeadership(): void
  isLeader(): boolean
  onLeadershipChange(callback: (isLeader: boolean) => void): void
}
```

#### 6.2 Web Locks Implementation
```typescript
class WebLocksLeader implements LeaderElection {
  private lockName = 'offline-executor-leader'
  
  async requestLeadership(): Promise<boolean> {
    return navigator.locks.request(
      this.lockName,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (lock) {
          // We are the leader
          await this.runAsLeader()
        }
      }
    )
  }
}
```

#### 6.3 Non-Leader Behavior
When a tab fails to acquire leadership:
- **Online-only mode**: Transactions execute immediately without persistence
- **No outbox writes**: Cannot safely persist to storage without coordination
- **State tracking**: `executor.isOfflineEnabled` indicates offline capability
- **Developer notification**: `onLeadershipChange` callback alerts when mode changes
- **Fallback behavior**: Acts like standard TanStack DB without offline support

### Phase 7: API Layer

#### 7.1 OfflineExecutor
```typescript
export function startOfflineExecutor(config: OfflineConfig): OfflineExecutor {
  return new OfflineExecutor(config)
}

class OfflineExecutor {
  readonly isOfflineEnabled: boolean  // true if this tab is the leader
  
  createOfflineTransaction(options: {
    mutationFnName: string
    autoCommit?: boolean
  }): OfflineTransaction
  
  createOfflineAction<T>(options: {
    mutationFnName: string
    onMutate: (vars: T) => void
  }): (vars: T) => Transaction
  
  async removeFromOutbox(id: string): Promise<void>
  async peekOutbox(): Promise<OfflineTransaction[]>
}
```

#### 7.2 Integration with Collections
When a collection is registered in the offline executor:
1. Wrap collection mutation methods
2. Auto-create offline transactions
3. Use collection ID as default mutationFnName
4. Handle replay through collection's existing mutation APIs

### Phase 8: State Restoration

#### 8.1 Transaction Replay
```typescript
class TransactionReplay {
  constructor(
    private executor: OfflineExecutor,
    private collections: Record<string, Collection>
  ) {}
  
  async replayAll(): Promise<void> {
    const transactions = await this.executor.peekOutbox()
    
    for (const tx of transactions) {
      await this.replayTransaction(tx)
    }
  }
  
  private async replayTransaction(tx: OfflineTransaction): Promise<void> {
    // Group mutations by collection
    // Call collection.insert/update/delete to restore optimistic state
  }
}
```

## Integration Points

### With Existing Transaction System
- Extend `Transaction` class with offline fields
- Reuse `PendingMutation` structure
- Leverage existing optimistic state management
- Hook into `createTransaction` for persistence

### With Collection API
- Collections registered with offline executor get automatic offline support
- Direct mutation calls (`insert`, `update`, `delete`) create offline transactions
- Preserve existing transaction semantics

### Example Usage
```typescript
// Setup
const offline = startOfflineExecutor({
  collections: { todos: todoCollection },
  mutationFns: {
    syncTodos: async ({ transaction, idempotencyKey }) => {
      await api.saveBatch(transaction.mutations, { idempotencyKey })
    }
  },
  onLeadershipChange: (isLeader) => {
    if (!isLeader) {
      console.warn('This tab is not the offline leader - running in online-only mode')
    }
  }
})

// Check offline status
if (offline.isOfflineEnabled) {
  console.log('Offline support is active')
} else {
  console.log('Running in online-only mode (another tab is the leader)')
}

// Usage - automatic offline (if leader)
todoCollection.insert({ id: '1', text: 'Buy milk' }) // Works offline if leader

// Usage - explicit transaction
const tx = offline.createOfflineTransaction({
  mutationFnName: 'syncTodos'
})

tx.mutate(() => {
  todoCollection.insert({ id: '2', text: 'Buy eggs' })
})
```

## Testing Strategy

### Unit Tests
- Storage adapters (quota, serialization)
- Key scheduler (parallel/sequential logic)
- Backoff calculator (timing, jitter)
- Leader election (multi-tab scenarios)

### Integration Tests
- End-to-end offline flow
- Network failure/recovery
- Application restart with pending transactions
- Multi-tab coordination

### Performance Tests
- Large transaction volumes
- Memory usage with many pending transactions
- Parallel execution throughput

## Migration Path

For existing TanStack DB users:
1. Install `@tanstack/offline-transactions`
2. Wrap collections with `startOfflineExecutor`
3. Define mutationFns for server sync
4. Existing code continues to work, now with offline support

## Risks & Mitigations

### Risk: Storage Quota Exceeded
**Mitigation**: Clear error messages, optional transaction pruning in `beforeRetry`

### Risk: Infinite Retry Loops
**Mitigation**: `NonRetriableError`, `beforeRetry` hook for filtering

### Risk: Multi-Tab Race Conditions
**Mitigation**: Leader election, bounded failover time

### Risk: Memory Leaks
**Mitigation**: Careful lifecycle management, transaction limits

## Success Criteria

1. **Zero data loss** during offline periods
2. **Transparent integration** - existing code works with minimal changes
3. **Performance** - <5ms overhead for normal operations
4. **Reliability** - automatic recovery from all failure modes
5. **Developer experience** - clear APIs, good error messages

## Next Steps

1. Create package structure
2. Implement storage adapters
3. Build outbox manager
4. Create minimal viable executor
5. Add retry and scheduling logic
6. Integrate with collections
7. Add multi-tab support
8. Write comprehensive tests
9. Create documentation and examples
