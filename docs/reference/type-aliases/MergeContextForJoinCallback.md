---
id: MergeContextForJoinCallback
title: MergeContextForJoinCallback
---

# Type Alias: MergeContextForJoinCallback\<TContext, TNewSchema\>

```ts
type MergeContextForJoinCallback<TContext, TNewSchema> = object & PreserveHasResultFlag<TContext["hasResult"]> & PreserveUnionFromFlag<TContext["hasUnionFrom"]> & PreserveFromSourceNames<TContext["fromSourceNames"]>;
```

Defined in: [packages/db/src/query/builder/types.ts:1258](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L1258)

MergeContextForJoinCallback - Special context for join condition callbacks

This type creates a context specifically for the `onCallback` parameter of join operations.
The key difference from `MergeContextWithJoinType` is that NO optionality is applied here.

**Why No Optionality?**
In SQL, join conditions are evaluated BEFORE optionality is determined. Both tables
must be treated as available (non-optional) within the join condition itself.
Optionality is only applied to the result AFTER the join logic executes.

**Example**:
```typescript
.from({ users })
.leftJoin({ orders }, ({ users, orders }) => {
  // users is NOT optional here - we can access users.id directly
  // orders is NOT optional here - we can access orders.userId directly
  return eq(users.id, orders.userId)
})
.where(({ orders }) => {
  // NOW orders is optional because it's after the LEFT JOIN
  return orders?.status === 'pending'
})
```

The simple intersection (&) merges schemas without any optionality transformation.

## Type Declaration

### baseSchema

```ts
baseSchema: TContext["baseSchema"];
```

### fromSourceName

```ts
fromSourceName: TContext["fromSourceName"];
```

### hasJoins

```ts
hasJoins: true;
```

### joinTypes

```ts
joinTypes: TContext["joinTypes"] extends Record<string, any> ? TContext["joinTypes"] : object;
```

### refsSchema

```ts
refsSchema: RefsSchemaForContext<TContext> & TNewSchema;
```

### result

```ts
result: TContext["result"];
```

### schema

```ts
schema: TContext["schema"] & TNewSchema;
```

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

### TNewSchema

`TNewSchema` *extends* [`ContextSchema`](ContextSchema.md)
