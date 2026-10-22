---
id: CursorExpressions
title: CursorExpressions
---

```ts
type CursorExpressions = object;
```

Defined in: [packages/db/src/types.ts:298](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L298)

Cursor expressions for pagination, passed separately from the main `where` clause.
The sync layer can choose to use cursor-based pagination (combining these with the where)
or offset-based pagination (ignoring these and using the `offset` parameter).

Neither expression includes the main `where` clause - they are cursor-specific only.

## Properties

### lastKey?

```ts
optional lastKey: string | number;
```

Defined in: [packages/db/src/types.ts:319](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L319)

Optional key of a provider-established continuation boundary. External
loadSubset callers may supply it after establishing provider coverage.
A local snapshot selection does not establish that coverage, so
CollectionSubscription never sets it. Adapters must also handle requests
without it.

***

### whereCurrent

```ts
whereCurrent: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:311](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L311)

Expression for rows equal to the current cursor value (first orderBy column only).
Used to handle tie-breaking/duplicates at the boundary.
Example: eq(col1, v1) or for Dates: and(gte(col1, v1), lt(col1, v1+1ms))

***

### whereFrom

```ts
whereFrom: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:305](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L305)

Expression for rows greater than (after) the cursor value.
Core emits this predicate from the leading order column. Multi-column
queries load the complete leading-value tie separately instead of
constructing a composite cursor.
