---
id: LiveInfiniteQueryConfig
title: LiveInfiniteQueryConfig
---

# Type Alias: LiveInfiniteQueryConfig\<TRow\>

```ts
type LiveInfiniteQueryConfig<TRow> = InfiniteQueryOptions & object;
```

Defined in: [useLiveInfiniteQuery.svelte.ts:101](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveInfiniteQuery.svelte.ts#L101)

## Type Declaration

### ~~getNextPageParam()?~~

```ts
optional getNextPageParam: (lastPage, allPages, lastPageParam, allPageParams) => number | undefined;
```

#### Parameters

##### lastPage

`TRow`[]

##### allPages

`TRow`[][]

##### lastPageParam

`number`

##### allPageParams

`number`[]

#### Returns

`number` \| `undefined`

#### Deprecated

Pagination uses the shared controller's peek-ahead strategy.
This remains for compatibility with TanStack Query conventions.

## Type Parameters

### TRow

`TRow`
