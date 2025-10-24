# Discord Bug: Duplicate Collection Alias in Subqueries

## Bug Report (from Discord)

**Reporter:** JustTheSyme
**Date:** 2025-10-24

When using the same collection with the same alias in both a subquery and the main query, two issues occurred:

1. **Empty Results**: Subquery with joins returns `[]` instead of expected data
2. **Aggregation Cross-Leaking**: Aggregated values show incorrect data (individual values instead of aggregates)

### Example from Discord

```typescript
const votes = useLiveQuery((q) => {
  const locksAgg = q
    .from({ lock: c.locksCollection })
    .join({ vote: c.votesCollection }, ({ lock, vote }) =>
      eq(lock._id, vote.lockId),
    )
    .groupBy(({ lock }) => [lock._id])
    .select(({ vote }) => ({
      _id: vote.lockId,
      totalPercent: sum(vote.percent),
    }))

  return q
    .from({ vote: c.votesCollection })  // ⚠️ "vote" alias reused!
    .join({ lockAgg }, ({ vote, lockAgg }) => eq(lockAgg._id, vote.lockId))
    .select(({ vote, lockAgg }) => ({
      ...vote,
      overallPercent: lockAgg?.totalPercent,  // Shows wrong values
    }))
})
```

**Expected:** `overallPercent` = sum of all votes (e.g., 45)
**Actual:** `overallPercent` = individual vote percent (e.g., 30)

## Root Cause

When both parent query and subquery use the same alias for a direct collection reference (e.g., both use `vote: votesCollection`), they **share the same input stream**. IVM streams are stateful, and this sharing causes interference between query contexts, leading to:
- Empty results when joins are involved
- Incorrect aggregation values (context leaking)

## Solution

After consultation with Sam, the fix is to **validate and prevent** this pattern rather than make it work.

### Implementation

Added validation that throws a clear error when a subquery reuses a parent's collection alias:

1. **New Error Type**: `DuplicateAliasInSubqueryError`
   - Clear message explaining the conflict
   - Lists parent query aliases for context
   - Suggests renaming the alias

2. **Validation Functions**:
   - `collectDirectCollectionAliases()`: Collects only CollectionRef aliases (not QueryRef)
   - `validateSubqueryAliases()`: Checks for conflicts before compiling subqueries

3. **Smart Detection**:
   - Only validates DIRECT collection references to allow legitimate subquery wrapping
   - Allows: `q.from({ issue: subquery })` where `issue` refers to subquery output
   - Prevents: Both using `{ vote: votesCollection }` directly

### Example Error

```typescript
QueryCompilationError: Subquery uses alias "vote" which is already used in the parent query.
Each alias must be unique across parent and subquery contexts.
Parent query aliases: vote, lock.
Please rename "vote" in either the parent query or subquery to avoid conflicts.
```

### User Workaround

Simply rename the alias in either the parent or subquery:

```typescript
// ✅ FIXED: Renamed "vote" to "v" in subquery
const locksAgg = q
  .from({ lock: c.locksCollection })
  .join({ v: c.votesCollection }, ({ lock, v }) =>  // Renamed!
    eq(lock._id, v.lockId)
  )
  .groupBy(({ lock }) => [lock._id])
  .select(({ v }) => ({
    _id: v.lockId,
    totalPercent: sum(v.percent),
  }))

return q
  .from({ vote: c.votesCollection })  // No conflict now
  .join({ lockAgg }, ({ vote, lockAgg }) => eq(lockAgg._id, vote.lockId))
  .select(({ vote, lockAgg }) => ({
    ...vote,
    overallPercent: lockAgg?.totalPercent,
  }))
```

## Files Modified

- `packages/db/src/errors.ts` - Added `DuplicateAliasInSubqueryError`
- `packages/db/src/query/compiler/index.ts` - Added validation in `processFrom()`
- `packages/db/src/query/compiler/joins.ts` - Added validation in `processJoinSource()`
- `packages/db/tests/query/discord-alias-bug.test.ts` - Test coverage for the bug

## Testing

Added comprehensive test coverage in `discord-alias-bug.test.ts`:
- Validates the error is thrown when aliases conflict
- Verifies the workaround (renaming) works correctly

---

**Investigation & Solution:** 2025-10-24
**Fixed By:** Claude Code
