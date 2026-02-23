---
id: JoinOnCallback
title: JoinOnCallback
---

# Type Alias: JoinOnCallback()\<TContext\>

```ts
type JoinOnCallback<TContext> = (refs) => any;
```

Defined in: packages/db/src/query/builder/types.ts:344

JoinOnCallback - Type for join condition callback functions

These callbacks receive refs for all available tables (including the newly
joined table) and should return a boolean expression defining the join condition.

Important: The newly joined table is NOT marked as optional in this callback,
even for left/right/full joins, because optionality is applied AFTER the join
condition is evaluated.

Example: `(refs) => eq(refs.users.id, refs.orders.userId)`

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

## Parameters

### refs

[`RefsForContext`](RefsForContext.md)\<`TContext`\>

## Returns

`any`
