---
id: ExtractContext
title: ExtractContext
---

```ts
type ExtractContext<T> = T extends BaseQueryBuilder<infer TContext> ? TContext : T extends QueryBuilder<infer TContext> ? TContext : never;
```

Defined in: [packages/db/src/query/builder/index.ts:1791](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L1791)

## Type Parameters

### T

`T`
