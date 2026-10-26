---
id: UseLiveQueryConfig
title: UseLiveQueryConfig
---

```ts
type UseLiveQueryConfig<TContext> = LiveQueryHookConfig<TContext> & object;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:111](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L111)

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
