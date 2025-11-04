# Nested Aggregates in SELECT with GROUP BY - Investigation Report

## Issue Summary

Users are reporting an error when trying to combine multiple aggregate functions using regular functions like `add()` and `coalesce()` in a `SELECT` clause with `groupBy()`.

**Error Message:**
```
Uncaught QueryCompilationError: Unknown expression type: agg
```

**Example User Code:**
```javascript
.select({
  totalPaidPieceRate: sum(ind.payoutPieceRate),  // ✅ Works fine
  totalPaidLaborTotal: coalesce(                 // ❌ Fails
    add(
      add(
        coalesce(add(sum(ind.payoutPieceRate), sum(ind.payoutDavisBacon)), 0),
        coalesce(add(sum(ind.payoutPieceRateDavisBaconGap), sum(ind.payoutAddons)), 0)
      ),
      coalesce(add(sum(ind.payoutHourly), sum(ind.payoutDrive)), 0)
    ),
    0
  ),
})
```

## Root Cause Analysis

### Architecture Overview

The query compilation process has these stages:

1. **SELECT Processing** (`processSelect` in `select.ts`):
   - Runs BEFORE aggregation
   - Compiles non-aggregate expressions
   - For aggregate expressions (type === 'agg'), creates placeholders that return `null`

2. **GROUP BY Processing** (`processGroupBy` in `group-by.ts`):
   - Runs AFTER select processing
   - Computes aggregate values
   - Updates `__select_results` with the computed aggregate values

3. **Expression Compilation** (`compileExpression` in `evaluators.ts`):
   - Compiles expressions into evaluator functions
   - Handles three types: `val`, `ref`, and `func`
   - **Does NOT handle `agg` type** - throws `UnknownExpressionTypeError`

### The Problem

When a user writes:
```javascript
add(sum(ind.payoutPieceRate), sum(ind.payoutDavisBacon))
```

The system tries to:
1. Compile the `add` function
2. Compile its arguments (two `sum` aggregates)
3. **FAILS** because `compileExpressionInternal` doesn't handle type `agg`

The error occurs at `evaluators.ts:67`:
```typescript
switch (expr.type) {
  case `val`: { ... }
  case `ref`: { ... }
  case `func`: { ... }
  default:
    throw new UnknownExpressionTypeError((expr as any).type)  // ← Throws here with type="agg"
}
```

### Why This Happens

The current architecture assumes a clear separation:
- **Regular expressions** (refs, funcs, vals) are evaluated BEFORE aggregation
- **Aggregates** (type='agg') are computed DURING aggregation
- These two types should never be mixed in the same expression

However, users want to write expressions that combine aggregates with regular functions, which creates a third category:
- **Post-aggregate expressions**: Regular functions that operate on aggregate results

## Current Workaround in HAVING Clauses

Interestingly, the system DOES support combining aggregates with functions in HAVING clauses!

The solution is in `replaceAggregatesByRefs` (`group-by.ts:390`):
```typescript
export function replaceAggregatesByRefs(
  havingExpr: BasicExpression | Aggregate,
  selectClause: Select,
  resultAlias: string = `result`
): BasicExpression {
  switch (havingExpr.type) {
    case `agg`: {
      // Find matching aggregate in SELECT clause
      // Replace with a reference to the computed aggregate
      return new PropRef([resultAlias, alias])
    }
    case `func`: {
      // Transform function arguments recursively
      const transformedArgs = funcExpr.args.map((arg) =>
        replaceAggregatesByRefs(arg, selectClause)
      )
      return new Func(funcExpr.name, transformedArgs)
    }
    // ... other cases
  }
}
```

This function:
1. Recursively scans expressions
2. Replaces `Aggregate` nodes with `PropRef` nodes pointing to computed values
3. Allows HAVING clauses to use expressions like: `gt(sum(users.age), 100)`

## Proposed Solution

To fix this issue, we need to extend the `replaceAggregatesByRefs` approach to SELECT clauses:

### Option 1: Transform Select Expressions (Recommended)

1. **Detection Phase**: Scan SELECT expressions to identify "post-aggregate" expressions
   - Any expression containing nested aggregates needs post-aggregate evaluation

2. **Extraction Phase**: Extract all aggregates from these expressions
   - Give each unique aggregate a generated alias (e.g., `__agg_0`, `__agg_1`)
   - Add them to the SELECT clause as separate fields

3. **Transformation Phase**: Transform the original expressions
   - Replace `Aggregate` nodes with `PropRef` nodes
   - The transformed expression can now be compiled normally

4. **Evaluation Phase**: Evaluate transformed expressions after aggregation
   - Use the computed aggregate values from `__select_results`

### Example Transformation

**Original User Code:**
```javascript
{
  total: add(sum(orders.amount1), sum(orders.amount2))
}
```

**After Transformation:**
```javascript
{
  __agg_0: sum(orders.amount1),        // Auto-generated
  __agg_1: sum(orders.amount2),        // Auto-generated
  total: add(ref('__agg_0'), ref('__agg_1'))  // Transformed
}
```

### Option 2: Two-Phase SELECT Processing

1. **Phase 1**: Before aggregation
   - Process non-aggregate expressions only

2. **Phase 2**: After aggregation
   - Process expressions containing aggregates
   - Aggregates are already computed and available

This is cleaner architecturally but requires more significant refactoring.

## Implementation Considerations

### Challenges

1. **Duplicate Aggregate Detection**: Need to recognize when the same aggregate appears multiple times
   - `add(sum(x), sum(x))` should only compute `sum(x)` once

2. **Naming Conflicts**: Auto-generated names must not conflict with user-defined aliases

3. **Type Safety**: Need to update TypeScript types to reflect this capability

4. **Performance**: Extra passes over expressions could impact compilation time

5. **Error Messages**: When transformation fails, error messages should be user-friendly

### Benefits

1. **Consistency**: Aligns SELECT behavior with HAVING behavior
2. **SQL Compatibility**: Matches how SQL handles aggregate expressions
3. **User Expectations**: Natural syntax for common operations

## Test Cases

The test file `packages/db/tests/query/nested-aggregates.test.ts` has been created to reproduce this issue.

### Test Case 1: Simple Add with Aggregates
```javascript
add(sum(ind.payoutPieceRate), sum(ind.payoutDavisBacon))
```

### Test Case 2: Complex Nested Expression
```javascript
coalesce(
  add(
    add(
      coalesce(add(sum(x), sum(y)), 0),
      coalesce(add(sum(z), sum(w)), 0)
    ),
    coalesce(add(sum(a), sum(b)), 0)
  ),
  0
)
```

## Related Files

- **Error Definition**: `/packages/db/src/errors.ts:429` (UnknownExpressionTypeError)
- **Expression Compiler**: `/packages/db/src/query/compiler/evaluators.ts:45` (compileExpressionInternal)
- **SELECT Processor**: `/packages/db/src/query/compiler/select.ts:131` (processSelect)
- **GROUP BY Processor**: `/packages/db/src/query/compiler/group-by.ts:71` (processGroupBy)
- **Aggregate Replacement**: `/packages/db/src/query/compiler/group-by.ts:390` (replaceAggregatesByRefs)
- **IR Types**: `/packages/db/src/query/ir.ts:125` (Aggregate class definition)

## Recommendation

Implement **Option 1** (Transform Select Expressions) as it:
- Reuses existing `replaceAggregatesByRefs` logic
- Requires minimal architectural changes
- Can be implemented incrementally
- Provides clear error messages when aggregates aren't in SELECT

The implementation would:
1. Add a new function `extractAndTransformAggregates` in `group-by.ts`
2. Call it from `processSelect` for expressions containing aggregates
3. Store transformed expressions for post-aggregate evaluation
4. Evaluate them after `processGroupBy` updates `__select_results`

## Current Status

This is a **confirmed bug** / **missing feature**. The system currently does not support nested aggregates in SELECT clauses, even though:
- It works in HAVING clauses
- Users naturally expect this to work
- It's a common SQL pattern
- The error message is not user-friendly

## Workaround for Users

Until this is fixed, users must:
1. Create separate aggregate fields
2. Use those in subsequent queries or calculations

```javascript
// Instead of:
.select({
  total: add(sum(x), sum(y))
})

// Use:
.select({
  sum_x: sum(x),
  sum_y: sum(y),
})
// Then in application code:
.map(row => ({ ...row, total: row.sum_x + row.sum_y }))

// OR use a subquery:
.from(
  db.query(table)
    .groupBy(...)
    .select({
      sum_x: sum(x),
      sum_y: sum(y),
    })
)
.select({
  total: add(ref.sum_x, ref.sum_y)  // This works because they're refs now
})
```
