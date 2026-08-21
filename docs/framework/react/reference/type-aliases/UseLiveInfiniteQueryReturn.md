---
id: UseLiveInfiniteQueryReturn
title: UseLiveInfiniteQueryReturn
---

# Type Alias: UseLiveInfiniteQueryReturn\<TContext\>

```ts
type UseLiveInfiniteQueryReturn<TContext> = Omit<ReturnType<typeof useLiveQuery>, "data"> & object;
```

Defined in: [useLiveInfiniteQuery.ts:68](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L68)

## Type Declaration

### data

```ts
data: InferResultType<TContext>;
```

### error

```ts
error: unknown;
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
