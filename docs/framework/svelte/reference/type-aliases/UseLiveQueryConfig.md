---
id: UseLiveQueryConfig
title: UseLiveQueryConfig
---

```ts
type UseLiveQueryConfig<TContext> = LiveQueryCollectionConfig<TContext> & object;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:108](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L108)

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
