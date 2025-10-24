# Investigation: Same Collection in Subquery and Main Query Bug

## Bug Report Summary (from Discord)

When using the same collection with the same alias in both a subquery and the main query, two issues occur:

1. **Empty Results**: When a subquery has a join with a collection, and the main query also uses that collection, the query returns empty results.

2. **Aggregation Cross-Leaking**: Aggregated values from subqueries show incorrect values (individual row values instead of aggregates).

Example:
```typescript
const locksAgg = q
  .from({ lock: c.locksCollection })
  .join({ vote: c.votesCollection }, ...) // Uses "vote" alias
  .groupBy(...)
  .select({ overallPercent: sum(vote.percent) })

return q
  .from({ vote: c.votesCollection })  // ALSO uses "vote" alias
  .join({ lockAgg }, ...)
  .select({ percent: vote.percent, overallPercent: lockAgg?.overallPercent })
```

Expected: `overallPercent` should be the sum (e.g., 45)
Actual: `overallPercent` equals individual `percent` values (e.g., 30)

## Root Cause Analysis

###  1. Shared Input Streams

The core issue is in the query compiler architecture:

- All queries (parent and subqueries) receive the same `allInputs` map containing keyed streams for each collection alias
- When a parent query and subquery both use the same alias (e.g., "vote"), they share the SAME input stream
- IVM streams are stateful, and sharing them between different query contexts causes interference

### 2. Caching Issues

The query compiler caches compiled queries using `QueryIR` as the key. When a subquery is compiled multiple times in different contexts, it returns the cached result from the first compilation, which has the wrong input bindings.

## Attempted Fix

I implemented a partial fix in `packages/db/src/query/compiler/index.ts` and `packages/db/src/query/compiler/joins.ts`:

1. **Input Filtering**: Created `collectQueryAliases()` to identify which collection aliases each query needs
2. **Fresh Cache**: Each subquery compilation uses a fresh `WeakMap` cache to prevent incorrect caching

### Code Changes

```typescript
// In processFrom() for QueryRef case:
const subqueryAliases = collectQueryAliases(originalQuery)
const filteredInputs: Record<string, KeyedStream> = {}
for (const alias of subqueryAliases) {
  if (allInputs[alias]) {
    filteredInputs[alias] = allInputs[alias]
  }
}

const subqueryCache = new WeakMap()
const subqueryMapping = new WeakMap()

const subQueryResult = compileQuery(
  originalQuery,
  filteredInputs,  // Filtered inputs
  collections,
  subscriptions,
  callbacks,
  lazySources,
  optimizableOrderByCollections,
  setWindowFn,
  subqueryCache,  // Fresh cache
  subqueryMapping
)
```

## Current Status

- ✅ Existing tests continue to pass (including nested subquery tests)
- ❌ The specific bug is NOT fixed - tests still show empty results and cross-leaking

## Why the Fix Doesn't Work

Even with filtering and fresh caching, the fundamental issue remains: **parent and subquery still share the same input streams** when they use the same alias. The filtering only determines WHICH streams to pass, but if both need "vote", they get the same stream instance.

## Proper Solution Required

This bug requires a more substantial architectural change:

### Option 1: Separate Streams Per Context
- Create independent input streams for each query compilation context
- Subqueries would get their own streams, not share the parent's
- Requires changes to how inputs are created and managed

### Option 2: Stream Isolation
- Implement a mechanism to "fork" or isolate streams when they're used in multiple contexts
- May require changes to the IVM layer

### Option 3: Alias Namespacing
- Internally rename aliases in subqueries to avoid conflicts
- E.g., parent uses "vote", subquery internally uses "vote_subquery_1"
- Requires careful tracking and remapping of aliases

## Recommendation

This issue requires deeper architectural discussion and likely a larger refactor. The current fix provides:
- Better cache isolation (prevents some edge cases)
- Foundation for future improvements

But does not solve the core bug. I recommend:

1. Creating an issue to track this as a known limitation
2. Documenting the workaround (wrapping in an extra `from()` layer)
3. Planning a larger refactor to properly support this use case

## Workaround for Users

As mentioned in the Discord thread, wrapping the query in another layer works:

```typescript
const problematicQuery = q
  .from({ vote: c.votesCollection })
  .join({ lockAgg }, ...)
  .where(...)

// Workaround: wrap in another from()
return q.from({ votesQ: problematicQuery })
  .where(({ votesQ }) => eq(votesQ.poolAddress, poolAddress))
```

This works because the wrapped query no longer directly uses "vote" at the top level, avoiding the alias conflict.

---

**Files Modified:**
- `packages/db/src/query/compiler/index.ts` (added collectQueryAliases, fresh cache for subqueries)
- `packages/db/src/query/compiler/joins.ts` (same changes for join processing)

**Investigation Date:** 2025-10-24
**Investigated By:** Claude Code
