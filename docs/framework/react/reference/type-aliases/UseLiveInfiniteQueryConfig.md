---
id: UseLiveInfiniteQueryConfig
title: UseLiveInfiniteQueryConfig
---

# Type Alias: UseLiveInfiniteQueryConfig\<TContext\>

```ts
type UseLiveInfiniteQueryConfig<TContext> = object;
```

Defined in: [useLiveInfiniteQuery.ts:29](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L29)

## Type Parameters

### TContext

`TContext` *extends* `Context`

## Properties

### ~~getNextPageParam()?~~

```ts
optional getNextPageParam: (lastPage, allPages, lastPageParam, allPageParams) => number | undefined;
```

Defined in: [useLiveInfiniteQuery.ts:37](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L37)

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

Defined in: [useLiveInfiniteQuery.ts:31](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L31)

***

### pageSize?

```ts
optional pageSize: number;
```

Defined in: [useLiveInfiniteQuery.ts:30](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L30)
