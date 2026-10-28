---
id: UseLiveInfiniteQueryConfig
title: UseLiveInfiniteQueryConfig
---

```ts
type UseLiveInfiniteQueryConfig<_TContext> = object;
```

Defined in: [useLiveInfiniteQuery.ts:46](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L46)

## Type Parameters

### _TContext

`_TContext` *extends* `Context`

## Properties

### client?

```ts
optional client: DbClient;
```

Defined in: [useLiveInfiniteQuery.ts:54](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L54)

Override the nearest DbProvider for this query.

***

### initialPageParam?

```ts
optional initialPageParam: number;
```

Defined in: [useLiveInfiniteQuery.ts:57](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L57)

First result-page label, not a server cursor or remote offset.

***

### pageSize?

```ts
optional pageSize: number;
```

Defined in: [useLiveInfiniteQuery.ts:55](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L55)

***

### queryKey?

```ts
optional queryKey: LiveQueryKey;
```

Defined in: [useLiveInfiniteQuery.ts:52](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L52)

Explicit identity for queries that contain opaque functional variants or
are hot enough that deriving identity from structured IR is too expensive.
Structured queries should omit this so DB can derive identity directly.
