---
id: UseLiveInfiniteQueryReturnWithCollection
title: UseLiveInfiniteQueryReturnWithCollection
---

# Type Alias: UseLiveInfiniteQueryReturnWithCollection\<TResult, TKey, TUtils\>

```ts
type UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils> = Omit<UseLiveQueryReturnWithCollection<TResult, TKey, TUtils, TResult[]>, "data"> & object;
```

Defined in: [packages/svelte-db/src/useLiveInfiniteQuery.svelte.ts:72](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveInfiniteQuery.svelte.ts#L72)

## Type Declaration

### data

```ts
data: TResult[];
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
pages: TResult[][];
```

## Type Parameters

### TResult

`TResult` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>
