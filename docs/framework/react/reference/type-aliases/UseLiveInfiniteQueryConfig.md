---
id: UseLiveInfiniteQueryConfig
title: UseLiveInfiniteQueryConfig
---

# Type Alias: UseLiveInfiniteQueryConfig\<TContext\>

```ts
type UseLiveInfiniteQueryConfig<TContext> = object;
```

Defined in: [useLiveInfiniteQuery.ts:44](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L44)

## Type Parameters

### TContext

`TContext` *extends* `Context`

## Properties

### client?

```ts
optional client: DbClient;
```

Defined in: [useLiveInfiniteQuery.ts:52](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L52)

Override the nearest DbProvider for this query.

***

### ~~getNextPageParam()?~~

```ts
optional getNextPageParam: (lastPage, allPages, lastPageParam, allPageParams) => number | undefined;
```

Defined in: [useLiveInfiniteQuery.ts:60](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L60)

#### Parameters

##### lastPage

`InferResultType`\<`TContext`\>\[`number`\][]

##### allPages

`InferResultType`\<`TContext`\>\[`number`\][][]

##### lastPageParam

`number`

##### allPageParams

`number`[]

#### Returns

`number` \| `undefined`

#### Deprecated

This callback is not used by the current implementation.
Pagination is determined internally via a peek-ahead strategy.
Provided for API compatibility with TanStack Query conventions.

***

### initialPageParam?

```ts
optional initialPageParam: number;
```

Defined in: [useLiveInfiniteQuery.ts:54](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L54)

***

### pageSize?

```ts
optional pageSize: number;
```

Defined in: [useLiveInfiniteQuery.ts:53](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L53)

***

### queryKey?

```ts
optional queryKey: LiveQueryKey;
```

Defined in: [useLiveInfiniteQuery.ts:50](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L50)

Explicit identity for queries that contain opaque functional variants or
are hot enough that deriving identity from structured IR is too expensive.
Structured queries should omit this so DB can derive identity directly.
