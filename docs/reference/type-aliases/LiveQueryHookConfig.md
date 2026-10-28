---
id: LiveQueryHookConfig
title: LiveQueryHookConfig
---

```ts
type LiveQueryHookConfig<TContext, TResult> = LiveQueryCollectionConfig<TContext, TResult> & object;
```

Defined in: [packages/db/src/query/live/types.ts:131](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/types.ts#L131)

A live query config that a framework hook accepts. Pass `pooledLiveQueries`
as `pool` to serve the query from a shared equality partition when its
shape allows. A config with any option other than `query`, `gcTime`, and
`pool` compiles its own Collection.

## Type Declaration

### pool?

```ts
optional pool: PooledLiveQueries;
```

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

### TResult

`TResult` *extends* `object` = `RootQueryResult`\<`TContext`\>
