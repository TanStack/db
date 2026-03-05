---
id: CursorExpressions
title: CursorExpressions
---

# Type Alias: CursorExpressions

```ts
type CursorExpressions = object;
```

Defined in: packages/db/src/types.ts:264

Cursor expressions for pagination, passed separately from the main `where` clause.
The sync layer can choose to use cursor-based pagination (combining these with the where)
or offset-based pagination (ignoring these and using the `offset` parameter).

Neither expression includes the main `where` clause - they are cursor-specific only.

## Properties

### lastKey?

```ts
optional lastKey: string | number;
```

Defined in: packages/db/src/types.ts:282

The key of the last item that was loaded.
Can be used by sync layers for tracking or deduplication.

***

### whereCurrent

```ts
whereCurrent: BasicExpression<boolean>;
```

Defined in: packages/db/src/types.ts:277

Expression for rows equal to the current cursor value (first orderBy column only).
Used to handle tie-breaking/duplicates at the boundary.
Example: eq(col1, v1) or for Dates: and(gte(col1, v1), lt(col1, v1+1ms))

***

### whereFrom

```ts
whereFrom: BasicExpression<boolean>;
```

Defined in: packages/db/src/types.ts:271

Expression for rows greater than (after) the cursor value.
For multi-column orderBy, this is a composite cursor using OR of conditions.
Example for [col1 ASC, col2 DESC] with values [v1, v2]:
  or(gt(col1, v1), and(eq(col1, v1), lt(col2, v2)))
