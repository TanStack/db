---
id: UseLiveQueryConfig
title: UseLiveQueryConfig
---

# Type Alias: UseLiveQueryConfig\<TContext\>

```ts
type UseLiveQueryConfig<TContext> = LiveQueryCollectionConfig<TContext> & object;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:78](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L78)

## Type Declaration

### client?

```ts
optional client: DbClient;
```

### queryKey?

```ts
optional queryKey: MaybeGetter<LiveQueryKey>;
```

## Type Parameters

### TContext

`TContext` *extends* `Context`
