---
id: QueryOnceConfig
title: QueryOnceConfig
---

# Interface: QueryOnceConfig\<TContext\>

Defined in: [packages/db/src/query/query-once.ts:18](https://github.com/TanStack/db/blob/main/packages/db/src/query/query-once.ts#L18)

Configuration options for queryOnce

## Type Parameters

### TContext

`TContext` *extends* [`Context`](Context.md)

## Properties

### query

```ts
query: 
  | (q) => QueryBuilder<TContext> & RootObjectResultConstraint<TContext>
| QueryBuilder<TContext> & RootObjectResultConstraint<TContext>;
```

Defined in: [packages/db/src/query/query-once.ts:22](https://github.com/TanStack/db/blob/main/packages/db/src/query/query-once.ts#L22)

Query builder function that defines the query
