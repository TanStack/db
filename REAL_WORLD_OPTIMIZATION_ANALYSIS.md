# Real-World Live Query Performance Analysis - Issue #445

## Executive Summary

After analyzing the actual application code that experienced 40%+ performance degradation, the root cause is fundamentally different from initial analysis:

**The Real Problem**: The application creates **240 separate live query collections** on every tab switch, each with identical query structure but different parameter values. This causes 240× compilation overhead.

**Critical Issue**: TanStack DB lacks **query parameterization** - each unique parameter combination creates a new collection with full compilation overhead.

---

## Application Code Analysis

### The Benchmark Application (test2.zip)

**File**: `src/component/app/main/MainShell.tsx`

```typescript
export const useOrderQuery = (rowId: string, side: TSide) => {
  return useLiveQuery(q =>
    q.from({ item: orderCollection })
      .where(({ item }) => and(
        eq(item.rowId, rowId),
        eq(item.side, side)
      )), [rowId, side]  // ← Dependencies create new collection when changed
  );
};

const RenderWithSelectorTanstack = memo((props: IGrid & IRowId & ISide) => {
  const order = useOrderQuery(props.rowId, props.side);  // ← Called 240 times
  return (
    <div className='side'>{order?.data?.[0]?.a}/{order?.data?.[0]?.b}</div>
  );
});
```

### The Scale

**Data Structure**:
- 2 tabs
- 12 grids per tab
- 10 rows per grid
- 2 sides per row (a, b)
- **Total**: 480 order records in collection

**Rendering on Tab Switch**:
- **240 components** mount (12 × 10 × 2)
- **240 `useOrderQuery()` calls** with unique `(rowId, side)` combinations
- **240 separate live query collections created**

**Performance Impact**:
```
Dev Build (4x CPU throttle):
- TanStack: 364ms average
- Redux: 155ms average
- Difference: 2.35x slower

Prod Build (4x CPU throttle):
- TanStack: 194ms average
- Redux: 63ms average
- Difference: 3.08x slower
```

---

## Root Cause Analysis

### Problem 1: No Query Parameterization ⭐⭐⭐ CRITICAL

**Current Behavior**:
```typescript
// Component 1
useOrderQuery('0|0', 'a')  // → Creates CollectionConfigBuilder #1
                           // → Full query compilation

// Component 2
useOrderQuery('0|0', 'b')  // → Creates CollectionConfigBuilder #2
                           // → Full query compilation AGAIN

// Component 3
useOrderQuery('0|1', 'a')  // → Creates CollectionConfigBuilder #3
                           // → Full query compilation AGAIN

// ... 237 more times ...
```

Each `useLiveQuery` call with different dependencies creates a new `CollectionConfigBuilder`:

**packages/react-db/src/useLiveQuery.ts** (not shown but implied behavior):
```typescript
export function useLiveQuery(query, deps) {
  // When deps change, this creates a NEW live query collection
  const collection = useMemo(
    () => createLiveQueryCollection(query),
    deps  // ← Dependency array causes recreation
  )
}
```

**What Should Happen**:
```typescript
// All 240 components should share ONE compiled query
// with different parameter bindings:

const sharedQuery = createParameterizedQuery(
  (rowId, side) => q.from({ item: orderCollection })
    .where(({ item }) => and(
      eq(item.rowId, rowId),
      eq(item.side, side)
    ))
)

// Component 1
useParameterizedQuery(sharedQuery, { rowId: '0|0', side: 'a' })  // ← Reuses compiled query

// Component 2
useParameterizedQuery(sharedQuery, { rowId: '0|0', side: 'b' })  // ← Reuses compiled query

// ... 238 more times, all reusing the same compilation ...
```

**Cost Savings**:
- Current: 240 compilations = ~240× cost
- Parameterized: 1 compilation + 240 parameter bindings = ~1× cost + negligible overhead

### Problem 2: Eager Compilation in Constructor ⭐⭐ HIGH IMPACT

**Location**: `packages/db/src/query/live/collection-config-builder.ts:144-174`

```typescript
constructor(config) {
  this.query = buildQueryFromConfig(config)
  this.collections = extractCollectionsFromQuery(this.query)
  // ...

  // Compile the base pipeline once initially
  // This is done to ensure that any errors are thrown immediately and synchronously
  this.compileBasePipeline()  // ← BLOCKS MAIN THREAD
}
```

**Impact on Tab Switch**:
```
Component Mount (×240)
  ↓
useLiveQuery() (×240)
  ↓
createLiveQueryCollection() (×240)
  ↓
new CollectionConfigBuilder() (×240)
  ↓
compileBasePipeline() (×240) ← ALL SYNCHRONOUS, BLOCKING MAIN THREAD
  ↓
(up to 10 optimizer iterations) × 240
  ↓
D2 graph creation × 240
  ↓
...finally render
```

**Total blocking time**: 240 × (optimization + compilation + graph creation)

### Problem 3: No Collection Reuse Across Unmount/Remount ⭐ MEDIUM IMPACT

When switching from Tab 0 → Tab 1 → Tab 0:

**Current**:
1. Tab 0 visible: 240 collections created
2. Switch to Tab 1: 240 collections destroyed, 240 new collections created
3. Switch back to Tab 0: 240 collections destroyed, 240 new collections created AGAIN

**Should**:
- Cache/pool collections by query signature + parameters
- Reuse collections when switching back to previously viewed tab

### Problem 4: Query Optimization Overhead × 240 ⭐ MEDIUM IMPACT

**Location**: `packages/db/src/query/optimizer.ts:192-219`

For this simple query pattern:
```typescript
q.from({ item: orderCollection })
  .where(({ item }) => and(eq(item.rowId, rowId), eq(item.side, side)))
```

**Current optimizer behavior**:
1. `splitAndClauses()` - splits AND into separate clauses
2. `analyzeWhereClause()` - analyzes each clause
3. `groupWhereClauses()` - groups by source
4. `applyOptimizations()` - attempts predicate pushdown
5. Iterates up to 10 times checking `deepEquals()` for convergence
6. For this simple query: converges in 1-2 iterations

**Overhead**:
- Still processes optimization pipeline even for trivial queries
- `deepEquals()` compares entire query tree each iteration
- Multiplied by 240 = significant cost

**Should**:
- Early exit for simple queries (no joins, single collection)
- OR: Share optimization results across parameterized queries

---

## Optimization Opportunities (Re-Prioritized)

### 🔴 CRITICAL: Query Parameterization System

**Priority**: P0 - Solves the fundamental architectural issue

**Approach 1: Parameterized Queries (Recommended)**

```typescript
// New API
export function createParameterizedQuery<TParams>(
  queryFn: (params: TParams) => QueryBuilder
) {
  // Compile ONCE with placeholder parameters
  const compiledTemplate = compileQueryTemplate(queryFn)

  return {
    execute: (params: TParams) => {
      // Bind parameters to compiled template
      return executeWithParams(compiledTemplate, params)
    }
  }
}

// Usage
const orderQuery = createParameterizedQuery<{ rowId: string, side: string }>(
  ({ rowId, side }) => q.from({ item: orderCollection })
    .where(({ item }) => and(
      eq(item.rowId, rowId),
      eq(item.side, side)
    ))
)

// In component (×240)
function Component({ rowId, side }) {
  const order = useParameterizedQuery(orderQuery, { rowId, side })
  // ...
}
```

**Benefits**:
- ✅ Compiles query structure ONCE
- ✅ 240 components share one compilation
- ✅ Parameter binding is cheap (no compilation)
- ✅ Maintains type safety

**Challenges**:
- ❌ Requires WHERE clause parameter binding support
- ❌ D2 graph would need parameter support
- ❌ Complex architectural change

**Approach 2: Client-Side Filtering (Quick Fix)**

```typescript
// Simpler approach: Load all data, filter in React
function Component({ rowId, side }) {
  // ONE shared query for entire collection
  const orders = useLiveQuery(q =>
    q.from({ item: orderCollection })
  )

  // Filter in memory (cheap)
  const order = orders.data?.find(o =>
    o.rowId === rowId && o.side === side
  )
}
```

**Benefits**:
- ✅ Only ONE live query collection for entire app
- ✅ Simple to implement
- ✅ Works with existing API

**Challenges**:
- ❌ No index optimization (loads all 480 records)
- ❌ Loses server-side filtering benefits
- ❌ Components re-render when unrelated data changes
- ❌ Doesn't scale to larger datasets

**Approach 3: Query Collection Pooling (Medium-term)**

```typescript
// Cache compiled queries by signature
const queryPool = new Map<string, CompiledQuery>()

function getOrCreateQuery(queryFn, params) {
  const signature = hashQueryStructure(queryFn)

  if (!queryPool.has(signature)) {
    queryPool.set(signature, compileQuery(queryFn))
  }

  return queryPool.get(signature).bindParams(params)
}
```

**Benefits**:
- ✅ Transparent optimization
- ✅ Automatic query reuse
- ✅ No API changes needed

**Challenges**:
- ❌ Need cache invalidation strategy
- ❌ Still needs parameter binding support
- ❌ Complex implementation

---

### 🔴 HIGH: Lazy Compilation

**Priority**: P0 - Quick win that reduces immediate cost

**Change**: Move compilation from `constructor()` to `syncFn()`

**Current**: 240 synchronous compilations on tab switch
**After**: Compilations spread across subscriptions (still 240, but potentially async)

**Impact**:
- Faster initial component mount
- Main thread less blocked
- Enables future async compilation

See `LIVE_QUERY_OPTIMIZATION_ANALYSIS.md` for implementation details.

---

### 🔴 HIGH: Fast Path for Simple Queries

**Priority**: P0 - Targets this specific use case

**Pattern Detection**:
```typescript
function compileQuery(query, ...) {
  // Detect simple pattern
  if (isSimpleQuery(query)) {
    return compileSimpleFast(query)
  }
  // Full optimization pipeline for complex queries
  return compileComplexQuery(query)
}

function isSimpleQuery(query: QueryIR): boolean {
  return (
    !query.join &&           // No joins
    !query.groupBy &&        // No aggregation
    !query.orderBy &&        // No ordering
    query.from.type === 'collectionRef'  // Direct collection reference
  )
}
```

**Benefits**:
- ✅ Skip expensive optimization for simple queries
- ✅ Direct compilation path
- ✅ Transparent optimization
- ✅ Solves this specific benchmark

**Impact**: Could reduce per-query cost by 50%+ for simple queries

---

### 🟡 MEDIUM: Collection Caching/Pooling

**Priority**: P1 - Improves tab switching performance

**Approach**: Cache collections by query signature + parameters

```typescript
const collectionCache = new LRU<string, Collection>({
  max: 500,
  dispose: (collection) => collection.cleanup()
})

function useLiveQuery(queryFn, deps) {
  const cacheKey = hashQuery(queryFn, deps)

  return useMemo(() => {
    const cached = collectionCache.get(cacheKey)
    if (cached) return cached

    const collection = createLiveQueryCollection(queryFn)
    collectionCache.set(cacheKey, collection)
    return collection
  }, deps)
}
```

**Benefits**:
- ✅ Tab 0 → Tab 1 → Tab 0: reuses cached collections
- ✅ Reduces redundant compilation
- ✅ Can be implemented at React hook level

---

### 🟡 MEDIUM: Optimizer Early Exit for Simple Queries

**Priority**: P1 - Reduces overhead for common case

See `LIVE_QUERY_OPTIMIZATION_ANALYSIS.md` optimization #3.

---

### 🟢 LOW: Other Optimizations

See `LIVE_QUERY_OPTIMIZATION_ANALYSIS.md` for:
- Query validation caching
- Collection extraction optimization
- Progressive initial loading

---

## Recommended Implementation Plan

### Phase 1: Immediate Wins (1-2 weeks)

1. **Fast Path for Simple Queries**
   - Detect simple query pattern
   - Skip optimization pipeline
   - Direct compilation
   - **Expected**: 30-50% improvement

2. **Lazy Compilation**
   - Move from constructor to syncFn
   - Unblock main thread
   - **Expected**: 10-20% improvement

3. **Collection Caching at Hook Level**
   - Cache in `useLiveQuery` hook
   - LRU eviction
   - **Expected**: Faster tab re-switching

**Combined Expected Impact**: 40-60% improvement (matches Redux performance)

### Phase 2: Architectural (2-3 months)

4. **Query Parameterization System**
   - Design parameter binding API
   - Implement template compilation
   - Add D2 graph parameter support
   - **Expected**: 90%+ improvement (near-Redux performance)

5. **Query Collection Pooling**
   - Global query pool
   - Smart reuse across components
   - **Expected**: Further reduces redundant work

---

## Comparison: Current vs Optimized

### Current (240 queries)

```
Tab Switch
  ↓
240 × (
  buildQuery
  + extractCollections (traverse #1)
  + extractAliases (traverse #2)
  + compileBasePipeline
    + validateQuery (recursive)
    + optimizeQuery (up to 10 iterations)
    + compileQuery
    + D2 graph creation
  + subscribe
)
= 190ms (prod, 4x throttle)
```

### Phase 1 Optimized (fast path + lazy)

```
Tab Switch
  ↓
240 × (
  buildQuery
  + extractCollections + extractAliases (combined)
  + [lazy compilation on first sync]
    + validateQuery (cached)
    + compileSimpleFast (no optimization)
    + D2 graph creation
  + subscribe
)
= ~80-100ms (estimated)
```

### Phase 2 Optimized (parameterized)

```
Tab Switch
  ↓
1 × (
  compile parameterized query template
  + D2 graph creation
)
+ 240 × (
  bind parameters (cheap)
  + subscribe
)
= ~65ms (near Redux performance)
```

---

## Additional Findings

### Why Redux is Faster

```typescript
// Redux approach (from selectors.ts)
const order = useSelector((state:IStore) =>
  getOrderBySideAndRowId(state, props)
)
```

**Redux advantages**:
1. Pre-indexed data structure (`state.orders[gridId].rows[rowId][side]`)
2. Memoized selectors (likely using `reselect`)
3. No query compilation
4. Simple object property access
5. Minimal overhead per component

**Redux disadvantages** (why user wants TanStack DB):
> "all the redux boilerplate... work you have to do to pre-index the store...
> is a lot of extra work and code"
>
> "With tanstack it'd be one if statement in a live query compared to
> hundreds of lines of code currently"

### The User's Actual Use Case

From README.md:
> "Even this demo doesn't quite show how much data our users have on the screen
> at one time, so any differentiation in speed gets multiplied significantly"

This means:
- Real application likely has MORE than 240 components
- Performance gap could be even larger in production
- Optimization is critical for TanStack DB adoption

---

## Measurement Recommendations

Add instrumentation to understand real costs:

```typescript
class CollectionConfigBuilder {
  constructor(config) {
    const start = performance.now()

    this.query = buildQueryFromConfig(config)
    const buildTime = performance.now() - start

    const extractStart = performance.now()
    this.collections = extractCollectionsFromQuery(this.query)
    const extractTime = performance.now() - extractStart

    const compileStart = performance.now()
    this.compileBasePipeline()
    const compileTime = performance.now() - compileStart

    if (debug) {
      console.log('[LiveQuery Init]', {
        buildTime,
        extractTime,
        compileTime,
        total: performance.now() - start
      })
    }
  }
}
```

This will show:
- Which phase is most expensive
- How much time is spent in optimization
- Validation of optimization impact

---

## Conclusion

The **root cause** of the 40%+ performance degradation is **lack of query parameterization**, causing 240 separate query compilations on every tab switch.

**Immediate Actions** (Phase 1):
1. Fast path for simple queries - skip optimization
2. Lazy compilation - unblock main thread
3. Collection caching - reuse across remounts

**Long-term Solution** (Phase 2):
4. Query parameterization system - compile once, execute many times
5. Query pooling - automatic reuse

**Expected Outcome**:
- Phase 1: Match Redux performance (40-60% improvement)
- Phase 2: Potentially beat Redux (native query language + optimized execution)

The current architecture is optimized for **few complex queries**, not **many simple queries**. The parameterization system would make TanStack DB viable for both use cases.
