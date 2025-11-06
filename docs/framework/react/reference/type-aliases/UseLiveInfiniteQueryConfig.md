---
id: UseLiveInfiniteQueryConfig
title: UseLiveInfiniteQueryConfig
---

# Type Alias: UseLiveInfiniteQueryConfig\<TContext\>

```ts
type UseLiveInfiniteQueryConfig<TContext> = object;
```

Defined in: useLiveInfiniteQuery.ts:23

## Type Parameters

### TContext

`TContext` *extends* `Context`

## Properties

### getNextPageParam()

```ts
getNextPageParam: (lastPage, allPages, lastPageParam, allPageParams) => number | undefined;
```

Defined in: useLiveInfiniteQuery.ts:26

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

***

### initialPageParam?

```ts
optional initialPageParam: number;
```

Defined in: useLiveInfiniteQuery.ts:25

***

### pageSize?

```ts
optional pageSize: number;
```

Defined in: useLiveInfiniteQuery.ts:24
