---
id: UseLiveInfiniteQueryReturnWithCollection
title: UseLiveInfiniteQueryReturnWithCollection
---

```ts
type UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils> = LiveQueryStatusFlags & object;
```

Defined in: [useLiveInfiniteQuery.ts:70](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L70)

## Type Declaration

### collection

```ts
collection: Collection<TResult, TKey, TUtils> & NonSingleResult;
```

### data

```ts
data: TResult[];
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

### isEnabled

```ts
isEnabled: true;
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

### state

```ts
state: Map<TKey, TResult>;
```

### status

```ts
status: CollectionStatus;
```

## Type Parameters

### TResult

`TResult` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>
