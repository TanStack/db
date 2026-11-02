---
id: ConditionalUseLiveQueryConfig
title: ConditionalUseLiveQueryConfig
---

```ts
type ConditionalUseLiveQueryConfig<TContext> = UseLiveQueryConfigOptions<TContext> & object;
```

Defined in: [useLiveQuery.ts:143](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L143)

## Type Declaration

### query

```ts
query: 
  | ConfiguredQueryBuilder<TContext>
  | (q) => ConfiguredQueryBuilder<TContext> | undefined | null;
```

## Type Parameters

### TContext

`TContext` *extends* `Context`
