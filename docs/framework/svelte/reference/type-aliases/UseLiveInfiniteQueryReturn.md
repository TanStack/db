---
id: UseLiveInfiniteQueryReturn
title: UseLiveInfiniteQueryReturn
---

# Type Alias: UseLiveInfiniteQueryReturn\<TContext\>

```ts
type UseLiveInfiniteQueryReturn<TContext> = Omit<ReturnType<typeof useLiveQuery>, "data"> & object;
```

Defined in: [useLiveInfiniteQuery.svelte.ts:59](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveInfiniteQuery.svelte.ts#L59)

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
