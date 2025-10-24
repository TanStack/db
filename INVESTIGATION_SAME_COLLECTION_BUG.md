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

## Solution Implemented

After Sam's insight, the fix is to **validate and prevent** alias reuse, not to make it work:

### Implementation

Added validation that throws a clear error when a subquery uses the same alias as its parent query for DIRECT collection references:

1. **New Error Type** (`DuplicateAliasInSubqueryError`):
   - Clear message explaining the conflict
   - Lists all parent aliases for context
   - Suggests renaming the alias

2. **Validation Logic**:
   - `collectDirectCollectionAliases()`: Collects only CollectionRef aliases, not QueryRef
   - `validateSubqueryAliases()`: Checks for conflicts before compiling subqueries
   - Only validates direct collection references to allow legitimate subquery wrapping

### Key Insight

The validation only checks **direct** collection references (CollectionRef), not subquery references (QueryRef). This allows:

```typescript
// ✅ ALLOWED: Different alias scopes
const subquery = q.from({ issue: issuesCollection })
return q.from({ issue: subquery })  // OK - "issue" refers to subquery output
```

```typescript
// ❌ PREVENTED: Same collection, same alias
const subquery = q.from({ lock: ... }).join({ vote: votesCollection }, ...)
return q.from({ vote: votesCollection }).join({ lock: subquery }, ...)
// Error: Both use "vote" for votesCollection directly
```

### Workaround for Users

Rename the alias in either the parent or subquery:

```typescript
// Discord bug - renamed "vote" to "v" in subquery
const locksAgg = q
  .from({ lock: c.locksCollection })
  .join({ v: c.votesCollection }, ({ lock, v }) =>  // Renamed!
    eq(lock._id, v.lockId)
  )

return q
  .from({ vote: c.votesCollection })  // No conflict now
  .join({ lock: locksAgg }, ...)
```

---

**Files Modified:**
- `packages/db/src/errors.ts` - Added `DuplicateAliasInSubqueryError`
- `packages/db/src/query/compiler/index.ts` - Added validation logic
- `packages/db/src/query/compiler/joins.ts` - Added validation logic
- `packages/db/tests/query/discord-alias-bug.test.ts` - Test for the Discord bug

**Investigation Date:** 2025-10-24
**Solution Date:** 2025-10-24
**Investigated & Fixed By:** Claude Code
