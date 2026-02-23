---
id: UseLiveInfiniteQueryReturn
title: UseLiveInfiniteQueryReturn
---

# Type Alias: UseLiveInfiniteQueryReturn\<TContext\>

```ts
type UseLiveInfiniteQueryReturn<TContext> = Omit<ReturnType<typeof useLiveQuery>, "data"> & object;
```

Defined in: useLiveInfiniteQuery.ts:34

## Type Declaration

### data

```ts
data: InferResultType<TContext>;
```

### fetchNextPage()

```ts
fetchNextPage: () => void;
```

#### Returns

`void`

### hasNextPage

```ts
hasNextPage: boolean;
```

### isFetchingNextPage

```ts
isFetchingNextPage: boolean;
```

### pageParams

```ts
pageParams: number[];
```

### pages

```ts
pages: InferResultType<TContext>[number][][];
```

## Type Parameters

### TContext

`TContext` *extends* `Context`
