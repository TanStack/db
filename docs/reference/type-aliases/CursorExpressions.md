---
id: CursorExpressions
title: CursorExpressions
---

# Type Alias: CursorExpressions

```ts
type CursorExpressions = object;
```

Defined in: [packages/db/src/types.ts:283](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L283)

Cursor expressions for pagination, passed separately from the main `where` clause.
The sync layer can choose to use cursor-based pagination (combining these with the where)
or offset-based pagination (ignoring these and using the `offset` parameter).

Neither expression includes the main `where` clause - they are cursor-specific only.

## Properties

### lastKey?

```ts
optional lastKey: string | number;
```

Defined in: [packages/db/src/types.ts:300](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L300)

The key of the last item that was loaded.
Can be used by sync layers for tracking or deduplication.

***

### whereCurrent

```ts
whereCurrent: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:295](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L295)

Expression for rows equal to the current cursor value (first orderBy column only).
Used to handle tie-breaking/duplicates at the boundary.
Example: eq(col1, v1) or for Dates: and(gte(col1, v1), lt(col1, v1+1ms))

***

### whereFrom

```ts
whereFrom: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:289](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L289)

Expression for rows greater than (after) the cursor value.
Core emits cursors for a single order column. Multi-column queries use
prefix-and-tie loading instead of constructing a composite cursor.
