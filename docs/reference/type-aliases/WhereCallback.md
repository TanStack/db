---
id: WhereCallback
title: WhereCallback
---

# Type Alias: WhereCallback()\<TContext\>

```ts
type WhereCallback<TContext> = (refs) => any;
```

Defined in: packages/db/src/query/builder/types.ts:123

WhereCallback - Type for where/having clause callback functions

These callbacks receive a `refs` object containing RefProxy instances for
all available tables. The callback should return a boolean expression
that will be used to filter query results.

Example: `(refs) => eq(refs.users.age, 25)`

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

## Parameters

### refs

[`RefsForContext`](RefsForContext.md)\<`TContext`\>

## Returns

`any`
