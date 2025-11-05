# Live Query Initialization Cost Analysis

## Executive Summary

This document analyzes the initialization cost of live queries in TanStack DB and identifies optimization opportunities. The analysis is based on GitHub issue #445, which reported 40%+ performance degradation when rendering many items, and subsequent investigation of the codebase.

**Status**: PR #732 already fixed the primary issue (multiple WHERE clauses creating separate filters). This analysis identifies **additional optimization opportunities** for further performance improvements.

---

## Background: Issue #445 & PR #732

### Original Problem
Multiple chained `.where()` clauses were creating separate `filter()` operations in the D2 pipeline:
```javascript
useLiveQuery(q =>
  q.from({ item: orderCollection })
    .where(({ item }) => eq(item.gridId, gridId))
    .where(({ item }) => eq(item.rowId, rowId))
    .where(({ item }) => eq(item.side, side))
)
```

### Solution Implemented
PR #732 combined multiple WHERE clauses into a single AND expression:
- For queries without joins: Combined at optimization time
- For queries with joins: Combined after predicate pushdown
- Result: Reduced from N filter operations to 1 filter operation

---

## Live Query Initialization Flow

```
createLiveQueryCollection()
  ↓
CollectionConfigBuilder.constructor()
  ├─ buildQueryFromConfig() → QueryIR
  ├─ extractCollectionsFromQuery() → traverses query tree
  ├─ extractCollectionAliases() → traverses query tree
  └─ compileBasePipeline() → EAGER COMPILATION
     ├─ validateQueryStructure() → recursive validation
     ├─ optimizeQuery() → up to 10 iterations
     │  ├─ splitAndClauses() → split WHERE clauses
     │  ├─ analyzeWhereClause() → analyze each clause
     │  ├─ groupWhereClauses() → group by source
     │  └─ applyOptimizations() → predicate pushdown
     ├─ compileQuery() → creates D2 pipeline
     │  ├─ processFrom() → may recursively compile subqueries
     │  ├─ processJoins() → process join clauses
     │  ├─ processSelect() → process SELECT clause
     │  └─ processOrderBy() → process ORDER BY clause
     └─ D2 graph finalization
  ↓
collection.startSync() triggers syncFn()
  ├─ subscribeToAllCollections() → per-alias subscriptions
  │  └─ CollectionSubscriber.subscribe() for each alias
  │     └─ collection.subscribeChanges() → initial snapshot
  └─ scheduleGraphRun() → initial execution
     └─ D2 graph runs, processes initial data
```

---

## Optimization Opportunities

### 1. **Lazy Compilation** ⭐ HIGH IMPACT
**Location**: `packages/db/src/query/live/collection-config-builder.ts:171-173`

**Current Behavior**:
```typescript
constructor(config) {
  this.query = buildQueryFromConfig(config)
  this.collections = extractCollectionsFromQuery(this.query)
  // ...
  // Compile the base pipeline once initially
  // This is done to ensure that any errors are thrown immediately and synchronously
  this.compileBasePipeline()  // ← EAGER COMPILATION
}
```

**Problem**: Every live query collection compiles its pipeline **immediately in the constructor**, even if:
- The query won't be used right away
- The collection is created but sync never starts
- The user creates the collection during initial app load but subscribes later

**Cost**:
- D2 graph creation: `new D2()`
- Input stream creation: One per alias
- Full query optimization (up to 10 iterations)
- Query compilation with all operators (filter, map, join, groupBy, orderBy)
- Graph finalization

**Recommendation**: Delay compilation until `syncFn()` is called:
```typescript
constructor(config) {
  this.query = buildQueryFromConfig(config)
  this.collections = extractCollectionsFromQuery(this.query)
  // ... other setup

  // DON'T compile yet - let it happen lazily
  // this.compileBasePipeline()
}

private maybeCompileBasePipeline() {
  if (!this.graphCache || !this.inputsCache || !this.pipelineCache) {
    this.compileBasePipeline()
  }
  // ...
}
```

**Impact**:
- Reduces initialization cost for unused queries
- Errors would be thrown on first use instead of construction (trade-off)
- Could add a `validate()` method for eager error checking if needed

**Trade-offs**:
- ✅ Faster initial creation
- ✅ No wasted work for unused queries
- ❌ Errors thrown lazily (on first sync) instead of eagerly
- ❌ Slightly more complex error handling

---

### 2. **Query Structure Validation Optimization** ⭐ MEDIUM IMPACT
**Location**: `packages/db/src/query/compiler/index.ts:103-106`

**Current Behavior**:
```typescript
export function compileQuery(...) {
  // Validate the raw query BEFORE optimization to check user's original structure.
  // This must happen before optimization because the optimizer may create internal
  // subqueries (e.g., for predicate pushdown) that reuse aliases, which is fine.
  validateQueryStructure(rawQuery)
  // ...
}
```

The validation recursively traverses the entire query tree checking for duplicate collection aliases:
```typescript
function validateQueryStructure(
  query: QueryIR,
  parentCollectionAliases: Set<string> = new Set()
): void {
  const currentLevelAliases = collectDirectCollectionAliases(query)

  // Check conflicts with parent aliases
  for (const alias of currentLevelAliases) {
    if (parentCollectionAliases.has(alias)) {
      throw new DuplicateAliasInSubqueryError(...)
    }
  }

  // Recursively validate FROM subquery
  if (query.from.type === `queryRef`) {
    validateQueryStructure(query.from.query, combinedAliases)
  }

  // Recursively validate JOIN subqueries
  if (query.join) {
    for (const joinClause of query.join) {
      if (joinClause.from.type === `queryRef`) {
        validateQueryStructure(joinClause.from.query, combinedAliases)
      }
    }
  }
}
```

**Problem**: For deeply nested subqueries, this does redundant work:
- Traverses the same subquery multiple times if reused
- Creates new Set objects for each recursion level
- No caching of validation results

**Recommendation**: Add validation result caching:
```typescript
const validationCache = new WeakMap<QueryIR, boolean>()

function validateQueryStructure(
  query: QueryIR,
  parentCollectionAliases: Set<string> = new Set()
): void {
  // Check cache first
  if (validationCache.has(query)) {
    return
  }

  // ... existing validation logic ...

  // Cache result
  validationCache.set(query, true)
}
```

**Impact**:
- Avoids redundant validation for reused subqueries
- Particularly beneficial for queries with multiple JOINs to the same subquery

---

### 3. **Optimizer Iteration Reduction** ⭐ MEDIUM IMPACT
**Location**: `packages/db/src/query/optimizer.ts:196-210`

**Current Behavior**:
```typescript
export function optimizeQuery(query: QueryIR): OptimizationResult {
  let optimized = query
  let previousOptimized: QueryIR | undefined
  let iterations = 0
  const maxIterations = 10 // Prevent infinite loops

  // Keep optimizing until no more changes occur or max iterations reached
  while (
    iterations < maxIterations &&
    !deepEquals(optimized, previousOptimized)
  ) {
    previousOptimized = optimized
    optimized = applyRecursiveOptimization(optimized)
    iterations++
  }
  // ...
}
```

**Problem**:
- Uses `deepEquals()` to detect convergence, which compares entire query trees
- For simple queries (no subqueries), typically converges in 1 iteration
- For queries with nested subqueries, may need 2-3 iterations
- The `deepEquals()` comparison itself has overhead

**Recommendation**:
1. Track specific optimization changes instead of full tree comparison:
```typescript
function applyRecursiveOptimization(query: QueryIR): {
  optimized: QueryIR,
  changed: boolean
} {
  let changed = false

  // Track if subqueries were optimized
  const subqueriesResult = optimizeSubqueries(query)
  changed ||= subqueriesResult.changed

  // Track if single-level optimization made changes
  const singleLevelResult = applySingleLevelOptimization(subqueriesResult.query)
  changed ||= singleLevelResult.changed

  return { optimized: singleLevelResult.query, changed }
}
```

2. Add early exit for queries without optimization opportunities:
```typescript
function canOptimize(query: QueryIR): boolean {
  // No WHERE clauses = nothing to optimize
  if (!query.where || query.where.length === 0) {
    return false
  }
  // No joins = only WHERE clause combining, do it once
  if (!query.join || query.join.length === 0) {
    return false
  }
  return true
}
```

**Impact**:
- Faster convergence detection
- Reduced `deepEquals()` overhead
- Early exit for simple queries

---

### 4. **Collection Extraction Optimization** ⭐ LOW IMPACT
**Location**: `packages/db/src/query/live/collection-config-builder.ts:150-164`

**Current Behavior**:
```typescript
constructor(config) {
  this.query = buildQueryFromConfig(config)
  this.collections = extractCollectionsFromQuery(this.query)  // Traverse #1
  const collectionAliasesById = extractCollectionAliases(this.query)  // Traverse #2
  // ...
}
```

Both functions recursively traverse the query tree:
- `extractCollectionsFromQuery()`: Collects collection instances by ID
- `extractCollectionAliases()`: Collects aliases by collection ID

**Problem**: Two separate traversals of the same tree structure.

**Recommendation**: Combine into a single traversal:
```typescript
function extractCollectionsAndAliases(query: QueryIR): {
  collections: Record<string, Collection>
  aliasesById: Map<string, Set<string>>
} {
  const collections: Record<string, Collection> = {}
  const aliasesById = new Map<string, Set<string>>()

  function traverse(q: QueryIR) {
    if (q.from.type === 'collectionRef') {
      collections[q.from.collection.id] = q.from.collection
      const aliases = aliasesById.get(q.from.collection.id) ?? new Set()
      aliases.add(q.from.alias)
      aliasesById.set(q.from.collection.id, aliases)
    } else if (q.from.type === 'queryRef') {
      traverse(q.from.query)
    }

    // ... handle joins similarly ...
  }

  traverse(query)
  return { collections, aliasesById }
}
```

**Impact**:
- Reduces tree traversals from 2 to 1
- Minor improvement (tree traversal is relatively cheap compared to compilation)

---

### 5. **Subscription Batching** ⭐ HIGH IMPACT (for many aliases)
**Location**: `packages/db/src/query/live/collection-config-builder.ts:776-831`

**Current Behavior**:
```typescript
private subscribeToAllCollections(config, syncState) {
  const compiledAliases = Object.entries(this.compiledAliasToCollectionId)

  // Create a separate subscription for each alias
  const loaders = compiledAliases.map(([alias, collectionId]) => {
    const collection = this.collectionByAlias[alias] ?? this.collections[collectionId]!
    const collectionSubscriber = new CollectionSubscriber(...)
    const subscription = collectionSubscriber.subscribe()  // ← Individual subscribe
    this.subscriptions[alias] = subscription
    return loadMore
  })
  // ...
}
```

Each `collectionSubscriber.subscribe()` call:
1. Converts WHERE clauses to BasicExpression
2. Creates a new subscription
3. Requests initial snapshot (potentially loading data from indexes)
4. Sets up event listeners

**Problem**: For queries with many aliases (self-joins, multiple JOINs), this creates N separate subscription operations that could potentially be batched.

**Current Benefit**: The system already has some optimization:
- WHERE clause filtering at subscription level (uses indexes)
- Lazy loading for certain joins
- ORDER BY optimization with windowing

**Recommendation**: For queries with multiple aliases referencing the same collection, consider:
```typescript
// Group aliases by collection
const aliasesByCollection = new Map<string, string[]>()
for (const [alias, collectionId] of compiledAliases) {
  const aliases = aliasesByCollection.get(collectionId) ?? []
  aliases.push(alias)
  aliasesByCollection.set(collectionId, aliases)
}

// Batch subscribe to each collection once, then distribute data
for (const [collectionId, aliases] of aliasesByCollection) {
  // Create a single subscription with combined WHERE clause
  // Then filter and distribute to individual inputs
}
```

**Trade-offs**:
- ✅ Fewer subscription objects
- ✅ Potential for combined WHERE clause evaluation
- ❌ More complex distribution logic
- ❌ May conflict with per-alias filtering optimization
- ❌ Self-joins need different filters per alias

**Impact**:
- Primarily benefits queries with many self-joins
- May not be worth the complexity given existing optimizations

---

### 6. **Initial Snapshot Loading** ⭐ HIGH IMPACT (for large collections)
**Location**: `packages/db/src/collection/subscription.ts` (not shown but referenced)

**Current Behavior**: When a subscription is created, it requests an initial snapshot:
```typescript
subscription = this.collection.subscribeChanges(sendChanges, {
  includeInitialState: true,  // ← Loads all matching rows
  whereExpression,
})
```

For ORDER BY queries with windowing:
```typescript
subscription.requestLimitedSnapshot({
  limit: offset + limit,  // Load only what's needed
  orderBy: normalizedOrderBy,
})
```

**Problem**: For non-windowed queries, the initial snapshot loads ALL matching data, which could be expensive for:
- Large collections with millions of rows
- Queries with complex WHERE clauses that match many rows
- Queries without ORDER BY optimization

**Recommendation**:
1. Add progressive loading for large result sets:
```typescript
const INITIAL_BATCH_SIZE = 100

subscription = this.collection.subscribeChanges(sendChanges, {
  includeInitialState: true,
  whereExpression,
  initialBatchSize: INITIAL_BATCH_SIZE,  // New option
})
```

2. Consider virtual scrolling hints from the UI layer:
```typescript
createLiveQueryCollection({
  query: (q) => q.from({ item: items }),
  loadingStrategy: {
    type: 'progressive',
    initialBatchSize: 100,
    batchSize: 50,
  }
})
```

**Impact**:
- Faster perceived performance for large datasets
- Reduced initial memory footprint
- Better time-to-interactive metrics

---

### 7. **D2 Graph Reuse** ⭐ MEDIUM IMPACT
**Location**: `packages/db/src/query/live/collection-config-builder.ts:570-605`

**Current Behavior**:
```typescript
private compileBasePipeline() {
  this.graphCache = new D2()  // ← New graph every time
  this.inputsCache = Object.fromEntries(
    Object.keys(this.collectionByAlias).map((alias) => [
      alias,
      this.graphCache!.newInput<any>(),  // ← New inputs
    ])
  )
  // ... compile query ...
}
```

**Problem**: Every live query creates its own D2 graph instance, even if multiple queries have identical structure with different parameters.

**Example**:
```typescript
// Three separate D2 graphs created
const query1 = createLiveQueryCollection(q =>
  q.from({ item: items }).where(({ item }) => eq(item.status, 'active'))
)
const query2 = createLiveQueryCollection(q =>
  q.from({ item: items }).where(({ item }) => eq(item.status, 'pending'))
)
const query3 = createLiveQueryCollection(q =>
  q.from({ item: items }).where(({ item }) => eq(item.status, 'completed'))
)
```

**Recommendation**: Explore query structure fingerprinting for pipeline reuse:
```typescript
function getQueryFingerprint(query: QueryIR): string {
  // Hash the query structure (ignoring parameter values)
  return hashStructure(query)
}

const pipelineCache = new Map<string, CompiledPipeline>()

function compileOrReuse(query: QueryIR) {
  const fingerprint = getQueryFingerprint(query)
  if (pipelineCache.has(fingerprint)) {
    return pipelineCache.get(fingerprint).clone()
  }

  const compiled = compileQuery(query)
  pipelineCache.set(fingerprint, compiled)
  return compiled
}
```

**Trade-offs**:
- ✅ Reduced compilation cost for similar queries
- ✅ Potential memory savings
- ❌ Complex cache invalidation
- ❌ Need to handle parameter binding
- ❌ D2 graphs may not be designed for cloning

**Impact**:
- Particularly beneficial for applications with many similar queries
- Would need significant D2 API changes

---

## Implementation Priority

### 🔴 High Priority (Quick Wins)

1. **Lazy Compilation** (#1)
   - Effort: Low (change when compilation happens)
   - Impact: High (eliminates wasted work)
   - Risk: Low (just move existing code)

2. **Initial Snapshot Progressive Loading** (#6)
   - Effort: Medium (add batching to subscription)
   - Impact: High (especially for large datasets)
   - Risk: Low (opt-in feature)

### 🟡 Medium Priority (Solid Improvements)

3. **Query Validation Caching** (#2)
   - Effort: Low (add WeakMap cache)
   - Impact: Medium (helps with nested subqueries)
   - Risk: Low (pure caching, no behavior change)

4. **Optimizer Iteration Reduction** (#3)
   - Effort: Medium (refactor iteration logic)
   - Impact: Medium (helps complex queries)
   - Risk: Low (preserve same results)

### 🟢 Low Priority (Nice to Have)

5. **Collection Extraction Optimization** (#4)
   - Effort: Low (combine traversals)
   - Impact: Low (minor improvement)
   - Risk: Low (simple refactor)

6. **D2 Graph Reuse** (#7)
   - Effort: High (requires D2 changes)
   - Impact: Medium (depends on usage patterns)
   - Risk: High (complex caching and cloning)

7. **Subscription Batching** (#5)
   - Effort: High (complex distribution logic)
   - Impact: Low (existing optimizations already good)
   - Risk: High (may conflict with per-alias filtering)

---

## Measurement Recommendations

Before implementing optimizations, add instrumentation to measure:

1. **Time to compile**: `compileBasePipeline()` duration
2. **Time to optimize**: `optimizeQuery()` duration and iteration count
3. **Time to first data**: From `startSync()` to first `commit()`
4. **Initial snapshot size**: Number of rows loaded initially
5. **Query reuse patterns**: How many queries have similar structures

Example instrumentation:
```typescript
private compileBasePipeline() {
  const start = performance.now()

  // ... existing compilation ...

  const duration = performance.now() - start
  if (typeof window !== 'undefined' && window.__TANSTACK_DB_DEBUG__) {
    console.log('[TanStack DB] Query compilation took', duration.toFixed(2), 'ms')
  }
}
```

---

## Conclusion

The PRIMARY performance issue from #445 has been addressed by PR #732 (combining WHERE clauses).

Additional optimization opportunities exist, with **Lazy Compilation** and **Progressive Initial Loading** offering the highest impact with lowest implementation risk.

The current implementation is already well-optimized for:
- ✅ WHERE clause combining (PR #732)
- ✅ Predicate pushdown optimization
- ✅ Index-based filtering at subscription level
- ✅ ORDER BY windowing for large sorted datasets
- ✅ Lazy loading for certain joins

Focus should be on:
1. Not doing work until needed (lazy compilation)
2. Not loading more data than needed (progressive loading)
3. Measuring real-world performance to validate improvements
