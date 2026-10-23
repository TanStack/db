---
id: QueryBuilder
title: QueryBuilder
---

```ts
type QueryBuilder<TContext> = Omit<BaseQueryBuilder<TContext>, "from" | "unionAll" | "_getQuery">;
```

Defined in: [packages/db/src/query/builder/index.ts:1781](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L1781)

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)
