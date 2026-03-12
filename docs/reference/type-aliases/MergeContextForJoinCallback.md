---
id: MergeContextForJoinCallback
title: MergeContextForJoinCallback
---

# Type Alias: MergeContextForJoinCallback\<TContext, TNewSchema\>

```ts
type MergeContextForJoinCallback<TContext, TNewSchema> = object;
```

Defined in: [packages/db/src/query/builder/types.ts:807](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L807)

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

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

### TNewSchema

`TNewSchema` *extends* [`ContextSchema`](ContextSchema.md)

## Properties

### baseSchema

```ts
baseSchema: TContext["baseSchema"];
```

Defined in: [packages/db/src/query/builder/types.ts:811](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L811)

***

### fromSourceName

```ts
fromSourceName: TContext["fromSourceName"];
```

Defined in: [packages/db/src/query/builder/types.ts:814](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L814)

***

### hasJoins

```ts
hasJoins: true;
```

Defined in: [packages/db/src/query/builder/types.ts:815](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L815)

***

### joinTypes

```ts
joinTypes: TContext["joinTypes"] extends Record<string, any> ? TContext["joinTypes"] : object;
```

Defined in: [packages/db/src/query/builder/types.ts:816](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L816)

***

### result

```ts
result: TContext["result"];
```

Defined in: [packages/db/src/query/builder/types.ts:819](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L819)

***

### schema

```ts
schema: TContext["schema"] & TNewSchema;
```

Defined in: [packages/db/src/query/builder/types.ts:813](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L813)
