# Noria Partially-Stateful Dataflow: Research & Application to TanStack DB

## Executive Summary

This document explores how Noria's partially-stateful dataflow concepts can inform TanStack DB's evolution. Noria, developed at MIT, proves that incremental view maintenance systems can keep **partial** materialized state, aggressively evict cold data, and reconstruct missing pieces on-demand via "upqueries"—all without breaking correctness.

TanStack DB's current architecture (D2-based IVM, live queries, loadSubset pagination) already provides strong foundations. This research identifies concrete, shippable features that would bring Noria's proven patterns to TanStack DB's client-side/edge context.

---

## Table of Contents

1. [Noria Architecture Deep Dive](#1-noria-architecture-deep-dive)
2. [TanStack DB Current State Analysis](#2-tanstack-db-current-state-analysis)
3. [Gap Analysis & Opportunities](#3-gap-analysis--opportunities)
4. [Proposed Features](#4-proposed-features)
5. [API Design Proposals](#5-api-design-proposals)
6. [Implementation Roadmap](#6-implementation-roadmap)
7. [Validation Strategy](#7-validation-strategy)
8. [Design Decisions Matrix](#8-design-decisions-matrix)

---

## 1. Noria Architecture Deep Dive

### 1.1 Core Concepts

**Partially-Stateful Dataflow** is Noria's key innovation. Unlike traditional materialized views that maintain complete state, Noria:

```
┌─────────────────────────────────────────────────────────────────┐
│                    NORIA'S PARTIAL STATE MODEL                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Full Materialization:     Partial Materialization:            │
│   ┌─────────────────┐       ┌─────────────────┐                │
│   │ A B C D E F G H │       │ A _ C _ _ F _ H │                │
│   │ (all keys hot)  │       │ (holes = cold)  │                │
│   └─────────────────┘       └─────────────────┘                │
│                                    │                            │
│                                    ▼                            │
│                             Upquery fills                       │
│                             holes on demand                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Upquery Mechanism

When a read hits a "hole" (missing state), Noria triggers an **upquery**:

```
1. Read request for key K arrives at operator O
2. O checks local state → K not present (hole)
3. O sends upquery to parent operators
4. Parents recursively process upquery
5. Results flow back down, filling holes
6. Original read completes with fresh data
```

**Key Properties:**
- **Correctness**: Upqueries replay exactly the computation that would have occurred
- **Efficiency**: Only requested keys are reconstructed
- **Bounded**: Upquery depth is bounded by dataflow graph depth
- **Concurrent**: Multiple upqueries can proceed in parallel

### 1.3 Eviction Strategies

Noria supports multiple eviction policies:

| Policy | Description | Use Case |
|--------|-------------|----------|
| LRU | Least Recently Used | General purpose |
| LFU | Least Frequently Used | Skewed access patterns |
| Random | Random eviction | Simple, low overhead |
| Generational | Young/old generations | Bursty workloads |

**Eviction Triggers:**
- Memory pressure (soft/hard limits)
- Time-based (TTL expiry)
- Explicit invalidation

### 1.4 State Management Invariants

Noria maintains critical invariants:

1. **Monotonic Reads**: Once a key is read, subsequent reads see same or newer values
2. **Eventual Consistency**: All operators eventually converge to correct state
3. **Upquery Consistency**: Upquery results are consistent with upstream state at query time
4. **No Lost Updates**: Updates during upquery are properly merged

---

## 2. TanStack DB Current State Analysis

### 2.1 Architecture Mapping

| Noria Concept | TanStack DB Equivalent | Gap |
|---------------|----------------------|-----|
| Dataflow operators | D2 operators (map, filter, join) | ✓ Parity |
| Difference streams | DifferenceStream with multiset | ✓ Parity |
| Materialized state | Collection state (SortedMap) | Partial |
| Partial state | Not implemented | **Gap** |
| Upqueries | loadSubset (different model) | **Gap** |
| Eviction policies | GC timeout only | **Gap** |
| Plan caching | WeakMap query cache | Partial |

### 2.2 Current State Model

```typescript
// Current: Full materialization per collection
CollectionStateManager {
  syncedData: SortedMap<TKey, TOutput>      // Complete synced state
  optimisticUpserts: Map<TKey, TOutput>      // Optimistic layer
  optimisticDeletes: Set<TKey>               // Optimistic deletes
}

// What Noria enables: Partial state with holes
PartialStateManager {
  materializedKeys: Set<TKey>                // Keys we have
  data: SortedMap<TKey, TOutput>             // Actual data
  pendingUpqueries: Map<TKey, Promise>       // In-flight fills
  evictionPolicy: EvictionPolicy             // LRU/LFU/etc
}
```

### 2.3 Current Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                    CURRENT TANSTACK DB FLOW                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Source Collection                                               │
│        │                                                         │
│        ▼                                                         │
│  ┌──────────────┐                                               │
│  │   D2 Graph   │  (operators: map, filter, join, groupBy)      │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐                                               │
│  │ Live Query   │  (full materialization of query result)       │
│  │ Collection   │                                               │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐                                               │
│  │ Subscription │  (filtered view via WHERE + indexes)          │
│  └──────────────┘                                               │
│                                                                  │
│  Problem: No partial state, no on-demand reconstruction         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.4 loadSubset Analysis

The current `loadSubset` mechanism provides pagination but differs from upqueries:

```typescript
// Current loadSubset - pagination-focused
interface LoadSubsetOptions {
  where?: BasicExpression<boolean>
  orderBy?: OrderBy
  limit?: number
  cursor?: CursorExpressions  // Pagination cursor
  offset?: number
}

// Key differences from Noria upqueries:
// 1. loadSubset is sync-layer, not dataflow-layer
// 2. No automatic triggering on "hole" access
// 3. No recursive upquery propagation
// 4. State stays after load (no eviction integration)
```

---

## 3. Gap Analysis & Opportunities

### 3.1 Critical Gaps

#### Gap 1: No Partial State Model
**Current**: Collections materialize all synced data
**Impact**: Memory grows with data size, not access patterns
**Opportunity**: Implement key-wise partial materialization

#### Gap 2: No On-Demand Reconstruction
**Current**: loadSubset requires explicit calls
**Impact**: Developers must manually manage data loading
**Opportunity**: Automatic upquery on "hole" access

#### Gap 3: Limited Eviction
**Current**: GC evicts entire collections after timeout
**Impact**: All-or-nothing eviction, no fine-grained control
**Opportunity**: Key-wise eviction with configurable policies

#### Gap 4: No Fill Status Visibility
**Current**: No way to know if data is "filling"
**Impact**: UI can't show loading states for partial data
**Opportunity**: Observable fill status per key/range

### 3.2 Alignment with TanStack DB Direction

The identified gaps align well with existing TanStack DB directions:

| Existing Direction | Noria Enhancement |
|-------------------|-------------------|
| Live queries | Partial live queries with holes |
| loadSubset pagination | Auto-triggered subset loading (upquery) |
| Optimistic updates | Optimistic + partial state composition |
| GC mechanism | Fine-grained eviction policies |

---

## 4. Proposed Features

### 4.1 Feature: Plan Caching & Eviction Policies

#### 4.1.1 Plan Cache Architecture

```typescript
interface PlanCache {
  // Query shape → compiled plan
  readonly size: number
  readonly hitRate: number

  get(queryShape: QueryShape): CompiledPlan | undefined
  set(queryShape: QueryShape, plan: CompiledPlan): void
  evict(queryShape: QueryShape): void
  clear(): void
}

interface PlanCacheConfig {
  maxSize: number                    // Max cached plans
  ttl: number                        // Time-to-live (ms)
  policy: 'lru' | 'lfu' | 'ttl'     // Eviction policy

  // Advanced
  costFunction?: (plan: CompiledPlan) => number
  onEvict?: (queryShape: QueryShape) => void
}
```

#### 4.1.2 State Eviction for Collections

```typescript
interface PartialStateConfig {
  // Eviction settings
  eviction: {
    policy: 'lru' | 'lfu' | 'random' | 'cost-aware'
    maxKeys: number                  // Max materialized keys
    maxMemory: number               // Memory budget (bytes)
    ttl: number                     // Key TTL (ms)
  }

  // Reconstruction settings
  reconstruction: {
    strategy: 'upquery' | 'sync' | 'lazy'
    maxConcurrent: number           // Max concurrent upqueries
    timeout: number                 // Upquery timeout (ms)
    retries: number                 // Retry count
  }
}
```

### 4.2 Feature: Reconstructable Views (Partial State Handles)

#### 4.2.1 Core Abstraction

```typescript
interface ReconstructableView<T, TKey> {
  // State inspection
  readonly materializedKeys: ReadonlySet<TKey>
  readonly totalEstimatedKeys: number
  readonly fillRatio: number  // materializedKeys.size / totalEstimatedKeys

  // Access with reconstruction
  get(key: TKey): Promise<T | undefined>
  getIfPresent(key: TKey): T | undefined  // No reconstruction

  // Bulk operations
  getMany(keys: TKey[]): Promise<Map<TKey, T>>
  prefetch(keys: TKey[]): Promise<void>

  // Eviction control
  pin(keys: TKey[]): void    // Prevent eviction
  unpin(keys: TKey[]): void
  evict(keys: TKey[]): void  // Manual eviction

  // Observability
  onFillStart(callback: (keys: TKey[]) => void): Unsubscribe
  onFillComplete(callback: (keys: TKey[], results: Map<TKey, T>) => void): Unsubscribe
  onEviction(callback: (keys: TKey[]) => void): Unsubscribe
}
```

#### 4.2.2 Fill Status

```typescript
type FillStatus =
  | { state: 'materialized' }
  | { state: 'filling'; progress: number; startedAt: number }
  | { state: 'hole' }
  | { state: 'error'; error: Error; retryAt?: number }

interface FillStatusObserver<TKey> {
  getStatus(key: TKey): FillStatus
  getStatuses(keys: TKey[]): Map<TKey, FillStatus>

  // Bulk status
  readonly fillingCount: number
  readonly holeCount: number
  readonly errorCount: number

  subscribe(callback: (changes: Map<TKey, FillStatus>) => void): Unsubscribe
}
```

### 4.3 Feature: Developer UX for Replay & Consistency

#### 4.3.1 Query Result Status

```typescript
interface PartialQueryResult<T> {
  // Data
  data: T[]

  // Completeness
  status: 'complete' | 'partial' | 'filling'
  missingKeys: Set<unknown>
  fillProgress: number  // 0-1

  // Timing
  materializedAt: number
  lastFillAt?: number

  // Actions
  waitForComplete(): Promise<T[]>
  requestFill(): Promise<void>
}
```

#### 4.3.2 React Integration

```typescript
// React hook with partial state awareness
function useLiveQuery<T>(query: Query<T>, options?: {
  waitForComplete?: boolean      // Block until fully materialized
  fillTimeout?: number           // Max wait for fill
  placeholderWhileFilling?: T[]  // Show while filling
}): {
  data: T[]
  status: 'complete' | 'partial' | 'filling' | 'error'
  fillProgress: number
  isStale: boolean
  refetch: () => Promise<void>
}
```

#### 4.3.3 Metrics & Observability

```typescript
interface PartialStateMetrics {
  // Eviction metrics
  evictions: {
    total: number
    byPolicy: Record<string, number>
    bytesReclaimed: number
  }

  // Fill metrics
  fills: {
    total: number
    inFlight: number
    avgLatency: number
    p99Latency: number
    failures: number
  }

  // Replay metrics (for upqueries)
  replay: {
    depth: Histogram  // How deep upqueries go
    width: Histogram  // How many keys per upquery
    cost: Histogram   // Computation cost
  }

  // Guardrails
  guardrails: {
    backoffEvents: number
    cappedReplays: number
    circuitBreakerTrips: number
  }
}
```

### 4.4 Feature: Update Mode Configuration

```typescript
interface CollectionUpdateMode {
  // Tuple-at-a-time: Lower latency, process each change immediately
  // Micro-batch: Higher throughput, batch changes before processing
  mode: 'tuple' | 'micro-batch'

  // Micro-batch settings
  batchSize?: number       // Max items per batch
  batchWindow?: number     // Max time to wait (ms)

  // Adaptive settings
  adaptive?: {
    enabled: boolean
    latencyTarget: number  // Switch to tuple below this
    throughputTarget: number  // Switch to batch above this
  }
}
```

---

## 5. API Design Proposals

### 5.1 Creating Partial Collections

```typescript
import { createCollection, createLiveQueryCollection } from '@tanstack/db'

// Standard collection with partial state enabled
const users = createCollection<User, number>({
  id: 'users',
  primaryKey: 'id',

  // NEW: Partial state configuration
  partialState: {
    enabled: true,
    eviction: {
      policy: 'lru',
      maxKeys: 10_000,
      ttl: 5 * 60 * 1000,  // 5 minutes
    },
    reconstruction: {
      strategy: 'upquery',
      maxConcurrent: 10,
      timeout: 5000,
    }
  },

  // Sync function provides upquery capability
  sync: ({ begin, write, commit, upquery }) => {
    // upquery is called when reconstruction is needed
    upquery.onRequest(async (keys) => {
      const data = await api.fetchUsers(keys)
      begin()
      for (const user of data) {
        write({ type: 'insert', key: user.id, value: user })
      }
      commit()
    })
  }
})
```

### 5.2 Live Query with Partial Awareness

```typescript
const activeUsersQuery = createLiveQueryCollection({
  id: 'active-users',
  query: query
    .from({ users })
    .where(({ users }) => eq(users.status, 'active'))
    .orderBy(({ users }) => desc(users.lastSeen)),

  // NEW: Partial query configuration
  partial: {
    // Initial materialization
    initialKeys: 100,  // Only materialize first 100

    // Auto-fill on scroll/access
    autoFill: {
      enabled: true,
      batchSize: 50,
      prefetchAhead: 2,  // Prefetch 2 batches ahead
    },

    // Eviction
    evictBehind: {
      enabled: true,
      keepBehind: 100,  // Keep 100 items behind viewport
    }
  }
})
```

### 5.3 Reconstructable View Handle

```typescript
// Get a reconstructable view from a collection
const view = users.asReconstructableView()

// Check if key is materialized
if (view.getIfPresent(userId)) {
  // Fast path - data available
  render(view.getIfPresent(userId))
} else {
  // Trigger fill and show loading
  showLoading()
  const user = await view.get(userId)
  render(user)
}

// Prefetch for anticipated access
await view.prefetch([1, 2, 3, 4, 5])

// Pin critical data
view.pin([currentUserId])

// Subscribe to fill events
view.onFillStart((keys) => {
  console.log(`Filling ${keys.length} keys...`)
})

view.onFillComplete((keys, results) => {
  console.log(`Filled ${results.size} keys in ${Date.now() - startTime}ms`)
})
```

### 5.4 React Integration

```typescript
import { useLiveQuery, usePartialState } from '@tanstack/react-db'

function UserList() {
  const {
    data,
    status,
    fillProgress,
    loadMore,
    hasMore
  } = useLiveQuery(activeUsersQuery, {
    // Wait for first page before rendering
    initialComplete: true,
    initialLimit: 50,
  })

  return (
    <div>
      {status === 'filling' && (
        <ProgressBar value={fillProgress} />
      )}

      <VirtualList
        items={data}
        onEndReached={loadMore}
        hasMore={hasMore}
      />
    </div>
  )
}

function UserDetail({ userId }: { userId: number }) {
  const { data: user, status } = usePartialState(users, userId)

  if (status === 'filling') {
    return <Skeleton />
  }

  if (status === 'error') {
    return <ErrorBoundary />
  }

  return <UserCard user={user} />
}
```

### 5.5 Consistency Controls

```typescript
// Strict path: wait for complete data
const completeData = await query.execute({
  consistency: 'complete',
  timeout: 5000
})

// Fast path: accept partial data
const partialData = await query.execute({
  consistency: 'partial',
  minFillRatio: 0.8  // At least 80% materialized
})

// Optimistic path: return immediately with current state
const immediateData = query.executeImmediate()
// Returns: { data, isComplete, missingKeys }
```

---

## 6. Implementation Roadmap

### Phase 1: Foundation (Core Infrastructure)

#### 1.1 Partial State Manager
```
Files to modify:
- packages/db/src/collection/state.ts
- packages/db/src/collection/partial-state.ts (new)

Tasks:
□ Add PartialStateManager class
□ Implement hole tracking (materializedKeys set)
□ Add fill status per key
□ Integrate with existing CollectionStateManager
```

#### 1.2 Eviction Framework
```
Files to modify:
- packages/db/src/eviction/index.ts (new)
- packages/db/src/eviction/policies/ (new directory)

Tasks:
□ Define EvictionPolicy interface
□ Implement LRU policy
□ Implement LFU policy
□ Implement cost-aware policy
□ Add eviction triggers (memory, count, TTL)
```

#### 1.3 Plan Cache Enhancement
```
Files to modify:
- packages/db/src/query/compiler/cache.ts (new)
- packages/db/src/query/compiler/index.ts

Tasks:
□ Extract plan caching into dedicated module
□ Add configurable eviction policies
□ Add cache metrics
□ Add cache size limits
```

### Phase 2: Upquery Mechanism

#### 2.1 Upquery Protocol
```
Files to create:
- packages/db/src/upquery/index.ts
- packages/db/src/upquery/protocol.ts
- packages/db/src/upquery/executor.ts

Tasks:
□ Define upquery message format
□ Implement upquery routing through D2 graph
□ Handle upquery batching
□ Implement upquery deduplication
```

#### 2.2 Sync Layer Integration
```
Files to modify:
- packages/db/src/collection/sync.ts
- packages/db/src/types.ts

Tasks:
□ Add upquery callback to sync interface
□ Implement upquery-to-loadSubset bridge
□ Handle concurrent upqueries
□ Add upquery timeout handling
```

### Phase 3: Developer Experience

#### 3.1 Fill Status Observable
```
Files to create:
- packages/db/src/collection/fill-status.ts

Tasks:
□ Implement FillStatusManager
□ Add per-key status tracking
□ Add bulk status queries
□ Implement status change subscriptions
```

#### 3.2 React Integration
```
Files to modify:
- packages/react-db/src/useLiveQuery.ts
- packages/react-db/src/usePartialState.ts (new)

Tasks:
□ Add status to useLiveQuery return
□ Create usePartialState hook
□ Add loading/filling states
□ Implement Suspense integration
```

#### 3.3 Metrics & Observability
```
Files to create:
- packages/db/src/metrics/partial-state.ts

Tasks:
□ Implement metrics collection
□ Add eviction metrics
□ Add fill/upquery metrics
□ Add guardrail metrics
□ Export for monitoring integration
```

### Phase 4: Optimization & Polish

#### 4.1 Adaptive Update Mode
```
Files to modify:
- packages/db/src/collection/update-mode.ts (new)

Tasks:
□ Implement tuple mode
□ Implement micro-batch mode
□ Add adaptive switching logic
□ Add per-collection configuration
```

#### 4.2 Guardrails
```
Files to create:
- packages/db/src/upquery/guardrails.ts

Tasks:
□ Implement upquery depth limits
□ Add concurrent upquery caps
□ Implement backoff for failing upqueries
□ Add circuit breaker for cascading failures
```

---

## 7. Validation Strategy

### 7.1 Micro-Benchmark Harness

```typescript
// benchmarks/partial-state.bench.ts

interface BenchmarkConfig {
  // Data shape
  keyCount: number          // Total keys in dataset
  valueSize: number         // Bytes per value

  // Access pattern
  accessPattern: 'uniform' | 'zipf' | 'temporal'
  zipfSkew?: number         // For zipf: higher = more skewed

  // Partial state config
  materializationRatio: number  // 0-1, how much to keep materialized
  evictionPolicy: 'lru' | 'lfu' | 'random'

  // Update mode
  updateMode: 'tuple' | 'micro-batch'
  batchSize?: number
}

interface BenchmarkResults {
  // Memory
  memoryUsed: number
  memorySaved: number       // vs full materialization
  memorySavedPercent: number

  // Latency
  readLatency: Histogram
  upqueryLatency: Histogram
  writeLatency: Histogram

  // Throughput
  readsPerSecond: number
  writesPerSecond: number
  upqueriesPerSecond: number

  // Efficiency
  hitRate: number           // Reads that hit materialized state
  upqueryRate: number       // Reads that triggered upquery
  evictionRate: number      // Evictions per second
}
```

### 7.2 Test Matrix

| Workload | Keys | Materialization | Eviction | Update Mode | Target Metric |
|----------|------|-----------------|----------|-------------|---------------|
| Read-heavy | 100K | 10% | LRU | Tuple | >95% hit rate |
| Write-heavy | 100K | 50% | LFU | Batch | <10ms p99 write |
| Mixed | 100K | 25% | LRU | Adaptive | Balance |
| Skewed | 1M | 5% | LFU | Tuple | >99% hit (zipf) |
| Bursty | 100K | 20% | Generational | Batch | Smooth latency |

### 7.3 Integration Test: Infinite/Paged Feeds

```typescript
// Test: Paged feed with partial state
describe('Paged Feed with Partial State', () => {
  it('should handle infinite scroll efficiently', async () => {
    const feed = createLiveQueryCollection({
      id: 'feed',
      query: feedQuery,
      partial: {
        initialKeys: 50,
        autoFill: { batchSize: 25 },
        evictBehind: { keepBehind: 100 }
      }
    })

    // Initial load
    const view = feed.asReconstructableView()
    expect(view.materializedKeys.size).toBe(50)

    // Scroll down
    await view.prefetch(range(50, 100))
    expect(view.materializedKeys.size).toBe(100)

    // Continue scrolling - old items evicted
    await view.prefetch(range(100, 200))
    expect(view.materializedKeys.size).toBeLessThanOrEqual(200)
    expect(view.getIfPresent(0)).toBeUndefined()  // Evicted

    // Scroll back up - triggers upquery
    const oldItem = await view.get(0)
    expect(oldItem).toBeDefined()
  })
})
```

### 7.4 Dogfood Scenarios

1. **Chat History**: Load recent messages, evict old ones, reconstruct on scroll-up
2. **User Directory**: Partial user list, reconstruct profiles on demand
3. **Analytics Dashboard**: Partial aggregates, fill detail on drill-down
4. **Document Editor**: Partial document state, reconstruct sections on navigation

---

## 8. Design Decisions Matrix

### 8.1 Update Mode

| Factor | Tuple-at-a-time | Micro-batch |
|--------|-----------------|-------------|
| Latency | Lower (immediate) | Higher (batched) |
| Throughput | Lower | Higher |
| Memory overhead | Lower | Higher (buffer) |
| CPU efficiency | Lower | Higher (amortized) |
| Use case | Real-time UIs | Analytics, bulk |

**Recommendation**: Default to tuple mode for TanStack DB's typical use cases (real-time UIs), with opt-in micro-batch for bulk operations.

### 8.2 Eviction Policy

| Policy | Best For | Overhead | Complexity |
|--------|----------|----------|------------|
| LRU | General use | Medium | Low |
| LFU | Stable hot sets | High | Medium |
| Random | Simple, low overhead | Low | Very Low |
| Cost-aware | Variable-size values | High | High |

**Recommendation**: Default to LRU (proven, understood), offer LFU for advanced users.

### 8.3 Isolation Semantics

| Semantic | Behavior | Use Case |
|----------|----------|----------|
| Read-committed | May see partial during fill | Default, most UIs |
| Snapshot | Complete snapshot or wait | Reports, exports |
| Serializable | Full consistency | Critical paths |

**Recommendation**: Default to read-committed with explicit opt-in to stricter levels.

### 8.4 Upquery vs Sync Reload

| Approach | Pros | Cons |
|----------|------|------|
| True Upquery | Efficient, minimal data | Complex, requires dataflow support |
| Sync Bridge | Simple, uses existing loadSubset | Less efficient, full round-trip |
| Hybrid | Best of both | Implementation complexity |

**Recommendation**: Start with sync bridge (leverages loadSubset), evolve to true upqueries.

---

## 9. References

### Academic Papers
- [Noria: dynamic, partially-stateful data-flow for high-performance web applications](https://www.usenix.org/conference/osdi18/presentation/gjengset) (OSDI 2018)
- [Partial State in Dataflow-Based Materialized Views](https://jon.thesquareplanet.com/papers/phd-thesis.pdf) (Jon Gjengset PhD Thesis)

### Related Work
- Differential Dataflow (Materialize, TimelyDataflow)
- Incremental View Maintenance (IVM) literature
- DBToaster: Higher-order delta processing

### TanStack DB Resources
- [Live Query Implementation](../packages/db/src/query/live-query-collection.ts)
- [D2 IVM Engine](../packages/db-ivm/src/d2.ts)
- [Collection State Manager](../packages/db/src/collection/state.ts)

---

## 10. Conclusion

Noria's partially-stateful dataflow provides a proven blueprint for TanStack DB's evolution. The key insights are:

1. **Partial state is viable**: Keeping only hot data and reconstructing cold data on-demand works at scale
2. **Upqueries maintain correctness**: On-demand reconstruction doesn't break consistency guarantees
3. **Eviction enables scale**: Aggressive eviction with smart policies keeps memory bounded
4. **Developer UX matters**: Clear status visibility and simple APIs make partial state approachable

TanStack DB's existing D2-based IVM, live queries, and loadSubset pagination provide strong foundations. The proposed features build incrementally on this foundation, bringing Noria's battle-tested patterns to the client-side/edge context where TanStack DB excels.

The implementation roadmap prioritizes:
1. Foundation (partial state, eviction) - enables the rest
2. Upquery mechanism - core value proposition
3. Developer UX - makes it usable
4. Optimization - makes it fast

With this approach, TanStack DB can offer developers the best of both worlds: the simplicity of reactive queries with the efficiency of partial materialization.
