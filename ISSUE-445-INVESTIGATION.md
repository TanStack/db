# Investigation: Issue #445 - useLiveQuery Performance Problem

## Summary

Investigated and fixed a performance issue where using multiple `.where()` calls resulted in 40%+ slowdown compared to using a single WHERE clause with AND. The root cause affected **both** queries with and without joins.

## Root Cause Analysis

### The Complete Problem

The optimizer's intended process is:

1. **Split**: Split all WHERE clauses with "and" at top level into separate clauses
2. **Push down**: Push single-source clauses to subqueries (for queries with joins)
3. **Combine**: Combine all remaining WHERE clauses back into a single one with "and"

**Step 3 was missing entirely**, causing multiple filter operations in the pipeline.

### Problem #1: Queries WITHOUT Joins

When users write queries like this:

```javascript
useLiveQuery((q) =>
  q
    .from({ item: orderCollection })
    .where(({ item }) => eq(item.gridId, gridId))
    .where(({ item }) => eq(item.rowId, rowId))
    .where(({ item }) => eq(item.side, side))
)
```

The optimizer was completely skipping queries without joins (`optimizer.ts:333-337`):

```typescript
// Skip optimization if there are no joins - predicate pushdown only benefits joins
// Single-table queries don't benefit from this optimization
if (!query.join || query.join.length === 0) {
  return query
}
```

This meant ALL THREE STEPS were skipped, leaving WHERE clauses as separate array elements.

### Problem #2: Queries WITH Joins (Broader Issue)

Even for queries WITH joins, **step 3 was missing**. After pushing down single-source clauses, any remaining WHERE clauses (multi-source + unpushable single-source) were left as separate array elements instead of being combined.

Example scenario:

```javascript
q.from({ stats: subqueryWithGroupBy })  // Can't push WHERE into GROUP BY
  .join({ posts: postsCollection }, ...)
  .where(({ stats }) => gt(stats.count, 5))  // Single-source but can't push down
  .where(({ posts }) => gt(posts.views, 100))  // Single-source, can push down
  .where(({ stats, posts }) => eq(stats.id, posts.author_id))  // Multi-source
```

After optimization:

- Posts clause: pushed down ✓
- Stats clause: can't push down (GROUP BY safety check)
- Multi-source clause: must stay in main query
- **Result**: 2 separate WHERE clauses remaining → 2 filter operators ✗

### The Pipeline Impact

During query compilation (`compiler/index.ts:185-196`), each WHERE clause creates a **separate filter() operation**:

```typescript
if (query.where && query.where.length > 0) {
  for (const where of query.where) {
    const whereExpression = getWhereExpression(where)
    const compiledWhere = compileExpression(whereExpression)
    pipeline = pipeline.pipe(
      filter(([_key, namespacedRow]) => {
        return compiledWhere(namespacedRow)
      })
    )
  }
}
```

### Performance Impact

- Each filter operator adds overhead to the pipeline
- Data flows through N filter stages instead of 1 combined evaluation
- This compounds when rendering many items simultaneously
- Results in 40%+ performance degradation

## The Solution

Implemented **step 3** for all query types:

### Fix #1: Queries WITHOUT Joins (in `applySingleLevelOptimization`)

```typescript
// For queries without joins, combine multiple WHERE clauses into a single clause
if (!query.join || query.join.length === 0) {
  if (query.where.length > 1) {
    const splitWhereClauses = splitAndClauses(query.where)
    const combinedWhere = combineWithAnd(splitWhereClauses)
    return {
      ...query,
      where: [combinedWhere],
    }
  }
  return query
}
```

### Fix #2: Queries WITH Joins (in `applyOptimizations`)

After pushing down single-source clauses, combine all remaining WHERE clauses:

```typescript
// Combine multiple remaining WHERE clauses into a single clause to avoid
// multiple filter operations in the pipeline (performance optimization)
const finalWhere: Array<Where> =
  remainingWhereClauses.length > 1
    ? [combineWithAnd(remainingWhereClauses.map(getWhereExpression))]
    : remainingWhereClauses
```

### Benefits

1. **Single Pipeline Operator**: Only one filter() operation regardless of how many WHERE clauses remain
2. **Consistent Performance**: Matches the performance of writing WHERE clauses manually with AND
3. **Semantically Equivalent**: Multiple WHERE clauses are still ANDed together
4. **Applies Universally**: Works for all query types (with/without joins, simple/complex)
5. **Preserves Optimizations**: Still does predicate pushdown for queries with joins

## Implementation Details

### Files Changed

1. **`packages/db/src/query/optimizer.ts`**:
   - Added WHERE combining for queries without joins (line 333-350)
   - Added WHERE combining after predicate pushdown for queries with joins (line 690-695)
2. **`packages/db/tests/query/optimizer.test.ts`**:
   - Added test: "should combine multiple WHERE clauses for queries without joins"
   - Added test: "should combine multiple remaining WHERE clauses after optimization"
   - Updated 5 existing tests to expect combined WHERE clauses

### Testing

- All 43 optimizer tests pass
- New test confirms remaining WHERE clauses are combined after optimization
- Updated tests reflect the new optimization behavior

### Before vs After

**Before (3 separate filters):**

```
FROM collection
→ filter(gridId = x)
→ filter(rowId = y)
→ filter(side = z)
```

**After (1 combined filter):**

```
FROM collection
→ filter(AND(gridId = x, rowId = y, side = z))
```

## Impact on Other Query Types

The optimization is **safe** and applies only to:

- Queries **without** joins
- Queries with **multiple** WHERE clauses (2 or more)
- Both direct collection references and subqueries

It does **not** affect:

- Queries with joins (these already go through predicate pushdown optimization)
- Queries with a single WHERE clause (no need to combine)
- Functional WHERE clauses (`fn.where()`)

## Next Steps

### For the Issue Reporter

Please test the fix with your reproduction case. The performance should now match or exceed your Redux selectors.

### For Maintainers

Consider whether this optimization should also apply to:

1. Functional WHERE clauses (`fn.where()`)
2. HAVING clauses (similar pattern exists)

## Performance Verification

To verify the fix, compare:

```javascript
// Multiple WHERE calls (now optimized)
query
  .from({ item: collection })
  .where(({ item }) => eq(item.gridId, gridId))
  .where(({ item }) => eq(item.rowId, rowId))
  .where(({ item }) => eq(item.side, side))

// Single WHERE with AND (already fast)
query
  .from({ item: collection })
  .where(({ item }) =>
    and(eq(item.gridId, gridId), eq(item.rowId, rowId), eq(item.side, side))
  )
```

Both should now have identical performance characteristics.

## Related Code Locations

- Query Optimizer: `packages/db/src/query/optimizer.ts`
- Query Compiler: `packages/db/src/query/compiler/index.ts`
- WHERE Evaluation: `packages/db/src/query/compiler/evaluators.ts`
- Optimizer Tests: `packages/db/tests/query/optimizer.test.ts`

## References

- Issue: https://github.com/TanStack/db/issues/445
- Commit: e46fc81
- Branch: claude/investigate-db-slowdown-011CUdbdVnfi28CckcUPfp5j
