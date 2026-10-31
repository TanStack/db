---
id: UseLiveInfiniteQueryReturn
title: UseLiveInfiniteQueryReturn
---

```ts
type UseLiveInfiniteQueryReturn<TContext> = Omit<ReturnType<typeof useLiveQuery>, "data"> & object;
```

Defined in: [useLiveInfiniteQuery.ts:58](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L58)

## Type Declaration

### data

```ts
data: InferResultType<TContext>;
```

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

#### Returns

`Promise`\<`void`\>

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
