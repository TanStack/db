---
id: OrderByCallback
title: OrderByCallback
---

# Type Alias: OrderByCallback()\<TContext\>

```ts
type OrderByCallback<TContext> = (refs) => any;
```

Defined in: [packages/db/src/query/builder/types.ts:302](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L302)

OrderByCallback - Type for orderBy clause callback functions

Similar to WhereCallback, these receive refs for all available tables
and should return expressions that will be used for sorting.

Example: `(refs) => refs.users.createdAt`

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

## Parameters

### refs

[`RefsForContext`](RefsForContext.md)\<`TContext`\>

## Returns

`any`
