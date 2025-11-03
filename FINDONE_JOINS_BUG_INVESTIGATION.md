# Investigation: findOne() with joins Type Inference Bug

## Problem Summary

When using `findOne()` after join operations in `useLiveQuery`, the type of `query.data` becomes `never`, causing TypeScript errors. This issue was reported on Discord.

### Example Code (Bug)

```typescript
const query = useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.id, id))
      .leftJoin({ todoOptions: todoOptionsCollection }, ({ todo, todoOptions }) =>
        eq(todo.id, todoOptions.todoId)
      )
      .findOne() // ❌ Causes type of query.data to become never
);
```

### Workaround

Using `limit(1)` instead of `findOne()` worked correctly:

```typescript
const query = useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.id, id))
      .leftJoin({ todoOptions: todoOptionsCollection }, ({ todo, todoOptions }) =>
        eq(todo.id, todoOptions.todoId)
      )
      .limit(1) // ✅ Works correctly
);
```

## Root Cause Analysis

### Type Flow Investigation

1. **After `from()`**:
   - Context has `singleResult: undefined` (property not set)

2. **After `leftJoin()`**:
   - `MergeContextWithJoinType` was explicitly setting `singleResult: false`
   - Line 577 in `/packages/db/src/query/builder/types.ts`:
     ```typescript
     singleResult: TContext['singleResult'] extends true ? true : false
     ```
   - This forces `singleResult` to `false` when it's not explicitly `true`

3. **After `findOne()`**:
   - `findOne()` returns `QueryBuilder<TContext & SingleResult>`
   - This creates an intersection: `{ singleResult: false } & { singleResult: true }`
   - TypeScript resolves this conflict as `{ singleResult: never }`
   - The `never` type propagates through the type system, breaking type inference

### The Bug

The issue was in the `MergeContextWithJoinType` type definition, which was forcing `singleResult` to be explicitly `false` instead of preserving its original value.

**Before (Buggy)**:
```typescript
export type MergeContextWithJoinType<
  TContext extends Context,
  TNewSchema extends ContextSchema,
  TJoinType extends `inner` | `left` | `right` | `full` | `outer` | `cross`,
> = {
  baseSchema: TContext[`baseSchema`]
  schema: ApplyJoinOptionalityToMergedSchema<...>
  fromSourceName: TContext[`fromSourceName`]
  hasJoins: true
  joinTypes: (TContext[`joinTypes`] extends Record<string, any>
    ? TContext[`joinTypes`]
    : {}) & {
    [K in keyof TNewSchema & string]: TJoinType
  }
  result: TContext[`result`]
  singleResult: TContext[`singleResult`] extends true ? true : false  // ❌ BUG HERE
}
```

## The Fix

Changed line 577 in `/packages/db/src/query/builder/types.ts` to preserve the `singleResult` value as-is:

**After (Fixed)**:
```typescript
export type MergeContextWithJoinType<
  TContext extends Context,
  TNewSchema extends ContextSchema,
  TJoinType extends `inner` | `left` | `right` | `full` | `outer` | `cross`,
> = {
  baseSchema: TContext[`baseSchema`]
  schema: ApplyJoinOptionalityToMergedSchema<...>
  fromSourceName: TContext[`fromSourceName`]
  hasJoins: true
  joinTypes: (TContext[`joinTypes`] extends Record<string, any>
    ? TContext[`joinTypes`]
    : {}) & {
    [K in keyof TNewSchema & string]: TJoinType
  }
  result: TContext[`result`]
  singleResult: TContext[`singleResult`]  // ✅ FIXED: Preserve value as-is
}
```

### Why This Works

By preserving `singleResult` as-is:
- If `findOne()` is called **before** join: `singleResult` is `true` and stays `true`
- If `findOne()` is called **after** join: `singleResult` is `undefined` and the intersection `undefined & { singleResult: true }` properly resolves to `{ singleResult: true }`
- No type conflict occurs

## Test Coverage Added

Added comprehensive type tests in `/packages/db/tests/query/join.test-d.ts`:

1. `findOne()` with `leftJoin` - returns single result with optional right table
2. `findOne()` with `innerJoin` - returns single result with both tables required
3. `findOne()` with `rightJoin` - returns single result with optional left table
4. `findOne()` with `fullJoin` - returns single result with both tables optional
5. `findOne()` with multiple joins - handles complex optionality correctly
6. `findOne()` with join and select - projects correctly
7. `findOne()` before join - works correctly in reverse order
8. `limit(1)` vs `findOne()` - confirms different return types

## Impact

This fix ensures that:
- ✅ `findOne()` works correctly with all join types (left, right, inner, full)
- ✅ Type inference works correctly for `query.data` in `useLiveQuery`
- ✅ No breaking changes to existing code
- ✅ Both `findOne()` before and after joins work correctly

## Files Modified

1. `/packages/db/src/query/builder/types.ts` (line 577) - Fixed type definition
2. `/packages/db/tests/query/join.test-d.ts` - Added 8 new type tests for findOne with joins

## Related Types

- `SingleResult`: `{ singleResult: true }`
- `NonSingleResult`: `{ singleResult?: never }`
- `Context`: Interface with optional `singleResult?: boolean`
- `InferResultType<TContext>`: Determines if result is `T | undefined` or `Array<T>`
