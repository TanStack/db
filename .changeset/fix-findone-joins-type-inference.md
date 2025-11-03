---
"@tanstack/db": patch
---

Fix type inference for findOne() when used with join operations

Previously, using `findOne()` with join operations (leftJoin, innerJoin, etc.) resulted in the query type being inferred as `never`, breaking TypeScript type checking:

```typescript
const query = useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .leftJoin({ todoOptions: todoOptionsCollection }, ...)
      .findOne() // Type became 'never'
)
```

**The Fix:**

Fixed the `MergeContextWithJoinType` type definition to conditionally include the `singleResult` property only when it's explicitly `true`, avoiding type conflicts when `findOne()` is called after joins:

```typescript
// Before (buggy):
singleResult: TContext['singleResult'] extends true ? true : false

// After (fixed):
} & (TContext['singleResult'] extends true ? { singleResult: true } : {})
```

**Why This Works:**

By using a conditional intersection that omits the property entirely when not needed, we avoid type conflicts. Intersecting `{} & { singleResult: true }` cleanly results in `{ singleResult: true }`, whereas the previous approach created conflicting property types resulting in `never`.

**Impact:**

- ✅ `findOne()` now works correctly with all join types
- ✅ Type inference works properly in `useLiveQuery` and other contexts
- ✅ Both `findOne()` before and after joins work correctly
- ✅ All 1413 existing tests pass with no breaking changes
