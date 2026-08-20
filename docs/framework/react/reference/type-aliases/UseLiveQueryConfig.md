---
id: UseLiveQueryConfig
title: UseLiveQueryConfig
---

# Type Alias: UseLiveQueryConfig\<TContext\>

```ts
type UseLiveQueryConfig<TContext> = LiveQueryCollectionConfig<TContext> & object;
```

Defined in: [useLiveQuery.ts:51](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQuery.ts#L51)

## Type Declaration

### client?

```ts
optional client: DbClient;
```

Override the nearest DbProvider for this query.

### queryKey?

```ts
optional queryKey: LiveQueryKey;
```

Explicit identity for queries that contain opaque functional variants or
are hot enough that deriving identity from structured IR is too expensive.
Structured queries should omit this so DB can derive identity directly.

## Type Parameters

### TContext

`TContext` *extends* `Context`
