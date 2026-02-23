---
id: GroupByCallback
title: GroupByCallback
---

# Type Alias: GroupByCallback()\<TContext\>

```ts
type GroupByCallback<TContext> = (refs) => any;
```

Defined in: packages/db/src/query/builder/types.ts:328

GroupByCallback - Type for groupBy clause callback functions

These callbacks receive refs for all available tables and should return
expressions that will be used for grouping query results.

Example: `(refs) => refs.orders.status`

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

## Parameters

### refs

[`RefsForContext`](RefsForContext.md)\<`TContext`\>

## Returns

`any`
