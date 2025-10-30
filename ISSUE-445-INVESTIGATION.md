# Investigation: Issue #445 - useLiveQuery Performance Problem

## Summary
Investigated and fixed a performance issue where using multiple `.where()` calls resulted in 40%+ slowdown compared to using a single WHERE clause with AND.

## Root Cause Analysis

### The Problem
When users write queries like this:
```javascript
useLiveQuery(q =>
  q.from({ item: orderCollection })
    .where(({ item }) => eq(item.gridId, gridId))
    .where(({ item }) => eq(item.rowId, rowId))
    .where(({ item }) => eq(item.side, side))
)
```

The optimizer was completely skipping queries without joins, as seen in `optimizer.ts:333-337`:
```typescript
// Skip optimization if there are no joins - predicate pushdown only benefits joins
// Single-table queries don't benefit from this optimization
if (!query.join || query.join.length === 0) {
  return query
}
```

This meant the three WHERE clauses remained as separate array elements. During query compilation (`compiler/index.ts:185-196`), each WHERE clause was applied as a **separate filter() operation** in the D2 pipeline:

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

This creates **three separate filter operators** in the pipeline instead of one, causing unnecessary overhead.

### Performance Impact
- Each filter operator adds overhead to the pipeline
- Data flows through multiple filter stages instead of a single combined evaluation
- This compounds when rendering many items simultaneously (as reported in the issue)
- Results in 40%+ performance degradation

## The Solution

Modified the optimizer to combine multiple WHERE clauses into a single AND expression for queries without joins:

```typescript
// For queries without joins, combine multiple WHERE clauses into a single clause
// to avoid creating multiple filter operators in the pipeline
if (!query.join || query.join.length === 0) {
  if (query.where.length > 1) {
    // Combine multiple WHERE clauses into a single AND expression
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

### Benefits
1. **Single Pipeline Operator**: Only one filter() operation is added to the pipeline instead of N operations
2. **Consistent Performance**: Performance matches single WHERE with AND
3. **Semantically Equivalent**: Multiple WHERE clauses are still ANDed together, just more efficiently
4. **Applies Broadly**: Works for simple FROM queries as well as nested subqueries

## Implementation Details

### Files Changed
1. **`packages/db/src/query/optimizer.ts`**: Added WHERE clause combining logic for queries without joins
2. **`packages/db/tests/query/optimizer.test.ts`**: Updated tests to expect combined WHERE clauses

### Testing
- All 42 optimizer tests pass
- Added new test case: "should combine multiple WHERE clauses for queries without joins"
- Updated 5 existing tests to reflect the new optimization behavior

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
query.from({ item: collection })
  .where(({ item }) => eq(item.gridId, gridId))
  .where(({ item }) => eq(item.rowId, rowId))
  .where(({ item }) => eq(item.side, side))

// Single WHERE with AND (already fast)
query.from({ item: collection })
  .where(({ item }) => and(
    eq(item.gridId, gridId),
    eq(item.rowId, rowId),
    eq(item.side, side)
  ))
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
