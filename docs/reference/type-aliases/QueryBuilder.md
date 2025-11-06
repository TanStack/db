---
id: QueryBuilder
title: QueryBuilder
---

# Type Alias: QueryBuilder\<TContext\>

```ts
type QueryBuilder<TContext> = Omit<BaseQueryBuilder<TContext>, "from" | "_getQuery">;
```

Defined in: packages/db/src/query/builder/index.ts:824

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../../interfaces/Context.md)
