---
id: QueryOnceConfig
title: QueryOnceConfig
---

# Interface: QueryOnceConfig\<TContext\>

Defined in: [packages/db/src/query/query-once.ts:8](https://github.com/TanStack/db/blob/main/packages/db/src/query/query-once.ts#L8)

Configuration options for queryOnce

## Type Parameters

### TContext

`TContext` *extends* [`Context`](Context.md)

## Properties

### query

```ts
query: 
  | QueryBuilder<TContext>
| (q) => QueryBuilder<TContext>;
```

Defined in: [packages/db/src/query/query-once.ts:12](https://github.com/TanStack/db/blob/main/packages/db/src/query/query-once.ts#L12)

Query builder function that defines the query
