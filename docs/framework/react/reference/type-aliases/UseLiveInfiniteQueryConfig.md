---
id: UseLiveInfiniteQueryConfig
title: UseLiveInfiniteQueryConfig
---

```ts
type UseLiveInfiniteQueryConfig<_TContext> = object;
```

Defined in: [useLiveInfiniteQuery.ts:43](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L43)

## Type Parameters

### _TContext

`_TContext` *extends* `Context`

## Properties

### client?

```ts
optional client: DbClient;
```

Defined in: [useLiveInfiniteQuery.ts:51](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L51)

Override the nearest DbProvider for this query.

***

### initialPageParam?

```ts
optional initialPageParam: number;
```

Defined in: [useLiveInfiniteQuery.ts:54](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L54)

First result-page label, not a server cursor or remote offset.

***

### pageSize?

```ts
optional pageSize: number;
```

Defined in: [useLiveInfiniteQuery.ts:52](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L52)

***

### queryKey?

```ts
optional queryKey: LiveQueryKey;
```

Defined in: [useLiveInfiniteQuery.ts:49](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L49)

Explicit identity for queries that contain opaque functional variants or
are hot enough that deriving identity from structured IR is too expensive.
Structured queries should omit this so DB can derive identity directly.
