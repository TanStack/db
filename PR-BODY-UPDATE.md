# Fix: Optimizer Missing Final Step - Combine Remaining WHERE Clauses

## Overview

Fixes issue #445 - performance issue when using multiple `.where()` calls. The root cause was broader than initially identified: **the optimizer was missing "step 3"** (combining remaining WHERE clauses), affecting both queries with and without joins.

## Problem Analysis

### The Optimizer's Intended Process

1. **Split**: Split WHERE clauses with AND at the root level into separate clauses
2. **Push down**: Push single-source clauses to subqueries (for queries with joins)
3. **Combine**: Combine all remaining WHERE clauses back into a single AND expression

**Step 3 was completely missing**, causing multiple `filter()` operations in the query pipeline.

### Two Types of Affected Queries

#### 1. Queries WITHOUT Joins (Reported in Issue #445)

```javascript
useLiveQuery((q) =>
  q
    .from({ item: orderCollection })
    .where(({ item }) => eq(item.gridId, gridId))
    .where(({ item }) => eq(item.rowId, rowId))
    .where(({ item }) => eq(item.side, side))
)
```

The optimizer was skipping these entirely, leaving **3 separate WHERE clauses** → **3 filter operators** in the pipeline.

#### 2. Queries WITH Joins (Broader Issue)

```javascript
q.from({ stats: subqueryWithGroupBy })  // Can't push WHERE into GROUP BY
  .join({ posts: postsCollection }, ...)
  .where(({ stats }) => gt(stats.count, 5))     // Can't push down (safety check)
  .where(({ posts }) => gt(posts.views, 100))   // Can push down ✓
  .where(({ stats, posts }) => eq(stats.id, posts.author_id))  // Multi-source
```

After predicate pushdown:

- Posts clause: pushed down ✓
- Stats clause + multi-source clause: **2 separate WHERE clauses remain** → **2 filter operators** ✗

### Performance Impact

Each filter operator adds overhead. Data flows through N filter stages instead of 1 combined evaluation, causing unnecessary performance degradation especially when rendering many items.

## Solution

Implemented "step 3" in two places:

### Fix #1: `applySingleLevelOptimization` (queries without joins)

```typescript
if (!query.join || query.join.length === 0) {
  if (query.where.length > 1) {
    const splitWhereClauses = splitAndClauses(query.where)
    const combinedWhere = combineWithAnd(splitWhereClauses)
    return { ...query, where: [combinedWhere] }
  }
  return query
}
```

### Fix #2: `applyOptimizations` (queries with joins)

```typescript
// After predicate pushdown, combine remaining WHERE clauses
const finalWhere: Array<Where> =
  remainingWhereClauses.length > 1
    ? [combineWithAnd(remainingWhereClauses.map(getWhereExpression))]
    : remainingWhereClauses
```

## Testing

- ✅ All 43 optimizer tests pass
- ✅ Added test: "should combine multiple WHERE clauses for queries without joins"
- ✅ Added test: "should combine multiple remaining WHERE clauses after optimization"
- ✅ Updated 5 existing tests to expect combined WHERE clauses

## Before vs After

**Before (Multiple filter operators):**

```
FROM collection
→ filter(gridId = x)
→ filter(rowId = y)
→ filter(side = z)
```

**After (Single combined filter):**

```
FROM collection
→ filter(AND(gridId = x, rowId = y, side = z))
```

## Benefits

1. **Single Pipeline Operator**: Only 1 filter operation regardless of how many WHERE clauses
2. **Consistent Performance**: Chaining `.where()` now performs identically to using `.where(and(...))`
3. **Semantically Equivalent**: Multiple WHERE clauses still ANDed together
4. **Universal Application**: Works for all query types (with/without joins, simple/complex)
5. **Preserves Optimizations**: Still performs predicate pushdown for queries with joins

## Files Changed

- `packages/db/src/query/optimizer.ts` - Added WHERE combining logic (2 locations)
- `packages/db/tests/query/optimizer.test.ts` - Added tests and updated existing ones
- `.changeset/optimize-multiple-where-clauses.md` - Changeset describing the fix
- `ISSUE-445-INVESTIGATION.md` - Detailed investigation report

## Credits

Thanks to colleague feedback for catching that step 3 was missing from the optimizer!

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
