# Query Pooling and Shared Pipeline Design

## Problem Statement

Currently, 240 similar queries each create:
- Separate subscriptions (240×)
- Separate D2 graph runs (240×)
- **Result**: 54.93ms of 71.43ms total time (77%)

**Goal**: Share subscriptions and graph execution across similar queries without causing extra renders.

---

## Key Challenges

1. **Detecting Similar Queries**: How to know two queries can share infrastructure
2. **Avoiding Extra Renders**: Only notify queries when THEIR data changes
3. **Lifecycle Management**: Handle mount/unmount without breaking other queries
4. **Parameter Binding**: Apply WHERE clause filters efficiently
5. **Memory Management**: Clean up shared resources when last query unmounts

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Query Pool Manager                    │
│  - Maintains registry of pooled queries                 │
│  - Creates shared subscriptions + D2 graphs              │
│  - Routes results to individual query instances          │
└─────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   ┌────▼────┐         ┌────▼────┐         ┌────▼────┐
   │ Query 1 │         │ Query 2 │   ...   │Query 240│
   │ (0|0,a) │         │ (0|0,b) │         │ (11|9,b)│
   └─────────┘         └─────────┘         └─────────┘
   Only renders        Only renders        Only renders
   when (0|0,a)       when (0|0,b)        when (11|9,b)
   changes            changes             changes
```

---

## Design Option 1: Shared Subscription with Client-Side Filtering

### Concept

- **One** subscription to base collection for all queries
- **One** D2 graph run processes all data
- Each query filters results client-side

### Implementation

```typescript
// query-pool.ts

/**
 * Signature for identifying similar queries that can share infrastructure
 */
interface QuerySignature {
  collectionId: string        // 'orders'
  queryStructure: string      // hash of query shape (from, select, etc)
  // Excludes: WHERE clause parameters (those vary per query)
}

/**
 * A pooled query handles multiple similar queries with different parameters
 */
class PooledQuery {
  signature: QuerySignature
  baseCollection: Collection

  // Shared infrastructure
  private sharedSubscription: CollectionSubscription | null = null
  private sharedData: Map<string, any> = new Map()

  // Individual query instances registered with this pool
  private instances: Map<string, QueryInstance> = new Map()

  // Reference counting for cleanup
  private refCount = 0

  constructor(signature: QuerySignature, baseCollection: Collection) {
    this.signature = signature
    this.baseCollection = baseCollection
  }

  /**
   * Register a new query instance with specific parameters
   */
  register(params: any, onUpdate: () => void): QueryInstance {
    this.refCount++

    // Create query instance
    const instanceId = hashParams(params)
    const instance = new QueryInstance(
      instanceId,
      params,
      onUpdate,
      this
    )

    this.instances.set(instanceId, instance)

    // Start shared subscription if this is the first instance
    if (this.refCount === 1) {
      this.startSharedSubscription()
    }

    // Immediately provide current data (if any)
    instance.updateFromSharedData(this.sharedData)

    return instance
  }

  /**
   * Unregister a query instance
   */
  unregister(instanceId: string) {
    this.instances.delete(instanceId)
    this.refCount--

    // Clean up shared subscription if no more instances
    if (this.refCount === 0) {
      this.stopSharedSubscription()
      queryPool.removePooledQuery(this.signature)
    }
  }

  /**
   * Start single subscription for all instances
   */
  private startSharedSubscription() {
    // Subscribe to entire collection (no WHERE clause)
    this.sharedSubscription = this.baseCollection.subscribeChanges(
      (changes) => this.handleSharedChanges(changes),
      { includeInitialState: true }
    )
  }

  /**
   * Stop shared subscription
   */
  private stopSharedSubscription() {
    this.sharedSubscription?.unsubscribe()
    this.sharedSubscription = null
    this.sharedData.clear()
  }

  /**
   * Handle changes from shared subscription
   * Only notify instances whose data actually changed
   */
  private handleSharedChanges(changes: Array<ChangeMessage>) {
    // Track which instances need updates
    const instancesToUpdate = new Set<QueryInstance>()

    for (const change of changes) {
      const { key, value, type } = change

      // Update shared data
      if (type === 'delete') {
        this.sharedData.delete(key)
      } else {
        this.sharedData.set(key, value)
      }

      // Check which instances care about this key
      for (const instance of this.instances.values()) {
        if (instance.matchesFilter(value)) {
          instancesToUpdate.add(instance)
        }
      }
    }

    // Update only affected instances (prevents extra renders!)
    for (const instance of instancesToUpdate) {
      instance.updateFromSharedData(this.sharedData)
      instance.notifyUpdate()
    }
  }
}

/**
 * Individual query instance with specific parameters
 */
class QueryInstance {
  id: string
  params: any
  private onUpdate: () => void
  private pool: PooledQuery

  // Instance-specific filtered data
  private filteredData: Map<string, any> = new Map()

  constructor(
    id: string,
    params: any,
    onUpdate: () => void,
    pool: PooledQuery
  ) {
    this.id = id
    this.params = params
    this.onUpdate = onUpdate
    this.pool = pool
  }

  /**
   * Check if a record matches this instance's filter
   */
  matchesFilter(record: any): boolean {
    // Apply WHERE clause parameters
    // For our example: eq(item.rowId, params.rowId) && eq(item.side, params.side)
    return (
      record.rowId === this.params.rowId &&
      record.side === this.params.side
    )
  }

  /**
   * Update filtered data from shared data
   */
  updateFromSharedData(sharedData: Map<string, any>) {
    this.filteredData.clear()

    for (const [key, value] of sharedData) {
      if (this.matchesFilter(value)) {
        this.filteredData.set(key, value)
      }
    }
  }

  /**
   * Get current data for this instance
   */
  getData(): Array<any> {
    return Array.from(this.filteredData.values())
  }

  /**
   * Notify React that data changed (triggers re-render)
   */
  notifyUpdate() {
    this.onUpdate()
  }

  /**
   * Cleanup
   */
  dispose() {
    this.pool.unregister(this.id)
  }
}

/**
 * Global query pool manager
 */
class QueryPoolManager {
  private pools: Map<string, PooledQuery> = new Map()

  /**
   * Get or create a pooled query for given signature
   */
  getOrCreatePool(
    signature: QuerySignature,
    baseCollection: Collection
  ): PooledQuery {
    const key = this.signatureToKey(signature)

    if (!this.pools.has(key)) {
      this.pools.set(key, new PooledQuery(signature, baseCollection))
    }

    return this.pools.get(key)!
  }

  /**
   * Remove pooled query (called when refCount reaches 0)
   */
  removePooledQuery(signature: QuerySignature) {
    const key = this.signatureToKey(signature)
    this.pools.delete(key)
  }

  private signatureToKey(signature: QuerySignature): string {
    return `${signature.collectionId}:${signature.queryStructure}`
  }
}

// Global singleton
export const queryPool = new QueryPoolManager()

/**
 * Helper to hash query parameters
 */
function hashParams(params: any): string {
  return JSON.stringify(params)
}
```

### Usage in useLiveQuery

```typescript
// Modified useLiveQuery hook

export function useLiveQuery(queryFn, deps = []) {
  const instanceRef = useRef<QueryInstance | null>(null)
  const [version, setVersion] = useState(0)

  // Analyze query to determine if it's poolable
  const queryAnalysis = useMemo(() => {
    const builder = new BaseQueryBuilder()
    const result = queryFn(builder)

    // Extract signature and parameters
    const signature = extractQuerySignature(result)
    const params = extractQueryParams(result)

    return { signature, params, result }
  }, deps)

  // Get or create pooled query
  useEffect(() => {
    const { signature, params } = queryAnalysis

    // Check if query is poolable (simple WHERE clauses only)
    if (!isPoolable(queryAnalysis.result)) {
      // Fall back to individual query (current behavior)
      // ... existing useLiveQuery logic
      return
    }

    // Get pooled query
    const pool = queryPool.getOrCreatePool(
      signature,
      baseCollection // extracted from query
    )

    // Register this instance
    instanceRef.current = pool.register(params, () => {
      setVersion(v => v + 1) // Trigger re-render
    })

    // Cleanup on unmount
    return () => {
      instanceRef.current?.dispose()
      instanceRef.current = null
    }
  }, [queryAnalysis])

  // Get current data
  const data = instanceRef.current?.getData() ?? []

  return {
    data,
    // ... other fields
  }
}

/**
 * Extract query signature (structure without parameters)
 */
function extractQuerySignature(queryIR: QueryIR): QuerySignature {
  return {
    collectionId: extractCollectionId(queryIR),
    queryStructure: hashQueryStructure(queryIR),
  }
}

/**
 * Extract query parameters (WHERE clause values)
 */
function extractQueryParams(queryIR: QueryIR): any {
  // For our example:
  // WHERE and(eq(item.rowId, '0|0'), eq(item.side, 'a'))
  // Returns: { rowId: '0|0', side: 'a' }

  return extractWhereParams(queryIR.where)
}

/**
 * Check if query can use pooling
 */
function isPoolable(queryIR: QueryIR): boolean {
  return (
    !queryIR.join &&           // No joins
    !queryIR.groupBy &&        // No aggregations
    !queryIR.orderBy &&        // No ordering
    !queryIR.select &&         // No projections (or simple ones)
    hasSimpleWhereClause(queryIR.where) // Only simple equality filters
  )
}
```

### Performance Impact

**Current**:
```
240 queries × (subscription + graph run)
= 240 × 0.229ms = 54.93ms
```

**With Pooling**:
```
1 shared subscription + 1 graph run + 240 × client filtering
= 0.229ms + (240 × 0.01ms)
= 0.229ms + 2.4ms = 2.63ms
```

**Savings**: 52.3ms (95% reduction in subscription + graph cost!)

**New total**: 71.43ms - 52.3ms = **19.13ms** for 240 queries

**Scaled to real-world**: 19.13ms × 2.72 = **52ms** (vs Redux 63ms) 🎉

---

## Design Option 2: Shared Graph with Parameterized Filters

### Concept

- Compile query ONCE with placeholder parameters
- Execute D2 graph ONCE for all queries
- Filter results using bound parameters

### Implementation

```typescript
// parameterized-query-pool.ts

/**
 * A compiled query template with parameter placeholders
 */
class CompiledQueryTemplate {
  signature: QuerySignature
  compiledPipeline: ResultStream
  d2Graph: D2
  parameterSchema: ParameterSchema

  constructor(queryIR: QueryIR, baseCollection: Collection) {
    this.signature = extractSignature(queryIR)

    // Compile query with parameter placeholders
    const { pipeline, graph, params } = compileWithParameters(
      queryIR,
      baseCollection
    )

    this.compiledPipeline = pipeline
    this.d2Graph = graph
    this.parameterSchema = params
  }

  /**
   * Execute graph once for all parameter sets
   */
  executeForAllParameters(
    parameterSets: Array<{ instanceId: string, params: any }>
  ): Map<string, Array<any>> {
    // Run graph once
    this.d2Graph.run()

    // Get all results
    const allResults = this.compiledPipeline.collect()

    // Distribute results by applying parameter filters
    const resultsByInstance = new Map<string, Array<any>>()

    for (const { instanceId, params } of parameterSets) {
      const filtered = allResults.filter(record =>
        matchesParams(record, params, this.parameterSchema)
      )
      resultsByInstance.set(instanceId, filtered)
    }

    return resultsByInstance
  }
}

/**
 * Pooled query with parameterized execution
 */
class ParameterizedPooledQuery {
  template: CompiledQueryTemplate
  instances: Map<string, ParameterizedQueryInstance> = new Map()
  subscription: CollectionSubscription | null = null

  register(params: any, onUpdate: () => void): ParameterizedQueryInstance {
    const instanceId = hashParams(params)
    const instance = new ParameterizedQueryInstance(
      instanceId,
      params,
      onUpdate,
      this
    )

    this.instances.set(instanceId, instance)

    // Start subscription if first instance
    if (this.instances.size === 1) {
      this.startSubscription()
    } else {
      // Execute for new instance immediately
      this.executeOnce()
    }

    return instance
  }

  private startSubscription() {
    this.subscription = this.baseCollection.subscribeChanges(
      () => this.executeOnce(),
      { includeInitialState: true }
    )
  }

  /**
   * Execute graph once for all instances
   */
  private executeOnce() {
    // Collect all parameter sets
    const parameterSets = Array.from(this.instances.values()).map(inst => ({
      instanceId: inst.id,
      params: inst.params
    }))

    // Execute once, get results for all
    const resultsByInstance = this.template.executeForAllParameters(
      parameterSets
    )

    // Update each instance
    for (const [instanceId, results] of resultsByInstance) {
      const instance = this.instances.get(instanceId)
      if (instance) {
        instance.updateResults(results)
        instance.notifyUpdate()
      }
    }
  }
}

class ParameterizedQueryInstance {
  private results: Array<any> = []

  updateResults(newResults: Array<any>) {
    // Only notify if actually changed
    if (!arrayEquals(this.results, newResults)) {
      this.results = newResults
    }
  }

  getData(): Array<any> {
    return this.results
  }
}
```

### Performance Impact

**With Parameterized Pooling**:
```
1 compilation (shared template)
+ 1 subscription
+ 1 graph run per change
+ 240 × parameter matching (very fast)

First init: ~1ms compilation + 0.229ms execution + 2.4ms filtering = 3.6ms
Subsequent: 0.229ms execution + 2.4ms filtering = 2.6ms per update
```

**Savings**: Even better than Option 1, plus compilation is shared!

---

## Design Option 3: Hybrid - Indexed Result Distribution

### Concept

- Build an index on the shared results by parameter values
- O(1) lookup instead of O(n) filtering

### Implementation

```typescript
class IndexedPooledQuery {
  // Index: Map<paramKey, Set<resultKey>>
  private resultIndex: Map<string, Set<string>> = new Map()
  private allResults: Map<string, any> = new Map()

  private handleSharedChanges(changes: Array<ChangeMessage>) {
    for (const change of changes) {
      const { key, value, type } = change

      if (type === 'delete') {
        // Remove from index
        this.removeFromIndex(key, value)
        this.allResults.delete(key)
      } else {
        // Add/update in index
        this.updateIndex(key, value)
        this.allResults.set(key, value)
      }
    }

    // Notify instances (O(1) lookup via index)
    for (const instance of this.instances.values()) {
      const resultKeys = this.lookupIndex(instance.params)
      const instanceResults = Array.from(resultKeys).map(k =>
        this.allResults.get(k)
      )

      instance.updateResults(instanceResults)
      instance.notifyUpdate()
    }
  }

  /**
   * Build index key from record
   * For our example: `${record.rowId}|${record.side}`
   */
  private getIndexKey(record: any): string {
    return `${record.rowId}|${record.side}`
  }

  /**
   * Update index when record changes
   */
  private updateIndex(recordKey: string, record: any) {
    const indexKey = this.getIndexKey(record)

    if (!this.resultIndex.has(indexKey)) {
      this.resultIndex.set(indexKey, new Set())
    }

    this.resultIndex.get(indexKey)!.add(recordKey)
  }

  /**
   * Remove from index when record deleted
   */
  private removeFromIndex(recordKey: string, record: any) {
    const indexKey = this.getIndexKey(record)
    this.resultIndex.get(indexKey)?.delete(recordKey)
  }

  /**
   * Lookup results by parameters (O(1))
   */
  private lookupIndex(params: any): Set<string> {
    const indexKey = `${params.rowId}|${params.side}`
    return this.resultIndex.get(indexKey) ?? new Set()
  }
}
```

### Performance Impact

**With Indexed Pooling**:
```
1 subscription + 1 graph run + index maintenance + 240 × O(1) lookups

Per change:
- Graph execution: 0.229ms
- Index update: ~0.1ms (building index)
- 240 × lookups: ~0.05ms (just hash lookups)
────────────────────────────────
Total: ~0.38ms per change
```

**Savings**: 54.93ms → 0.38ms = **99.3% reduction!**

---

## Avoiding Extra Renders

### The Problem

```typescript
// Bad: Notifies ALL instances when ANY data changes
private handleSharedChanges(changes) {
  this.updateSharedData(changes)

  // ❌ This triggers 240 renders even if only 1 query's data changed!
  for (const instance of this.instances.values()) {
    instance.notifyUpdate()
  }
}
```

### Solution 1: Change Tracking

```typescript
private handleSharedChanges(changes) {
  const affectedInstances = new Set<QueryInstance>()

  for (const change of changes) {
    // Determine which instances care about this change
    const indexKey = this.getIndexKey(change.value)

    for (const instance of this.instances.values()) {
      const instanceKey = `${instance.params.rowId}|${instance.params.side}`

      if (instanceKey === indexKey) {
        affectedInstances.add(instance)
      }
    }
  }

  // ✅ Only notify instances whose data actually changed
  for (const instance of affectedInstances) {
    instance.updateResults(...)
    instance.notifyUpdate() // Only these render!
  }
}
```

### Solution 2: Reverse Index

```typescript
class PooledQuery {
  // Map parameter key → Set of instances
  private instancesByParams: Map<string, Set<QueryInstance>> = new Map()

  register(params: any, onUpdate: () => void): QueryInstance {
    const instance = new QueryInstance(...)

    // Index instance by its parameters
    const paramKey = `${params.rowId}|${params.side}`
    if (!this.instancesByParams.has(paramKey)) {
      this.instancesByParams.set(paramKey, new Set())
    }
    this.instancesByParams.get(paramKey)!.add(instance)

    return instance
  }

  private handleSharedChanges(changes) {
    for (const change of changes) {
      // O(1) lookup of affected instances
      const indexKey = this.getIndexKey(change.value)
      const affected = this.instancesByParams.get(indexKey)

      if (affected) {
        // ✅ Only notify exact instances that match
        for (const instance of affected) {
          instance.notifyUpdate()
        }
      }
    }
  }
}
```

---

## Recommendation: Hybrid Approach

**Best solution combines**:
1. **Indexed result distribution** (O(1) lookups, 99% reduction)
2. **Reverse instance index** (O(1) notification targeting)
3. **Reference counting** (automatic cleanup)

### Expected Performance

**Current** (240 separate queries):
- Construction: 16.5ms
- Subscription + graph: 54.93ms
- **Total: 71.43ms**

**With Pooling** (1 shared query):
- Construction: 16.5ms (could be reduced to ~1ms with parameterization)
- Subscription + graph: 0.4ms (99% reduction!)
- **Total: ~17ms** (76% faster!)

**Scaled to real-world**:
- Current: 194ms
- With pooling: **~46ms**
- Redux: 63ms
- **Result: 27% FASTER than Redux! 🎉**

---

## Implementation Path

### Phase 1: Infrastructure (2-3 weeks)
1. Create `QueryPoolManager` class
2. Implement `PooledQuery` with indexing
3. Add reverse instance index
4. Add reference counting

### Phase 2: Integration (1-2 weeks)
5. Add pooling detection to `useLiveQuery`
6. Extract query signatures and parameters
7. Route poolable queries through pool
8. Fall back to individual queries for complex cases

### Phase 3: Testing & Optimization (2-3 weeks)
9. Add comprehensive tests
10. Benchmark against current implementation
11. Profile and optimize hot paths
12. Handle edge cases (concurrent updates, rapid mount/unmount)

**Total: 5-8 weeks for production-ready implementation**

---

## Next Steps

1. **Prototype**: Build minimal proof-of-concept with test2.zip pattern
2. **Benchmark**: Measure actual performance gains
3. **Iterate**: Refine based on real-world testing
4. **Productionize**: Add error handling, edge cases, tests

Would you like me to start implementing the prototype?
