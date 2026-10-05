---
id: UseLiveInfiniteQueryConfig
title: UseLiveInfiniteQueryConfig
---

```ts
type UseLiveInfiniteQueryConfig<_TContext> = object;
```

Defined in: [useLiveInfiniteQuery.ts:47](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L47)

## Type Parameters

### _TContext

`_TContext` *extends* `Context`

## Properties

### client?

```ts
optional client: DbClient;
```

Defined in: [useLiveInfiniteQuery.ts:55](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L55)

Override the nearest DbProvider for this query.

***

### initialPageParam?

```ts
optional initialPageParam: number;
```

Defined in: [useLiveInfiniteQuery.ts:58](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L58)

First result-page label, not a server cursor or remote offset.

***

### pageSize?

```ts
optional pageSize: number;
```

Defined in: [useLiveInfiniteQuery.ts:56](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L56)

***

### queryKey?

```ts
optional queryKey: LiveQueryKey;
```

Defined in: [useLiveInfiniteQuery.ts:53](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L53)

Explicit identity for queries that contain opaque functional variants or
are hot enough that deriving identity from structured IR is too expensive.
Structured queries should omit this so DB can derive identity directly.
