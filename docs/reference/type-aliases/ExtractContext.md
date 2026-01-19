---
id: ExtractContext
title: ExtractContext
---

# Type Alias: ExtractContext\<T\>

```ts
type ExtractContext<T> = T extends BaseQueryBuilder<infer TContext> ? TContext : T extends QueryBuilder<infer TContext> ? TContext : never;
```

Defined in: [packages/db/src/query/builder/index.ts:900](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/index.ts#L900)

## Type Parameters

### T

`T`
