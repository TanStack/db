---
id: UseLiveInfiniteQueryReturnWithCollection
title: UseLiveInfiniteQueryReturnWithCollection
---

```ts
type UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils> = object;
```

Defined in: [useLiveInfiniteQuery.ts:80](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L80)

## Type Parameters

### TResult

`TResult` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

## Properties

### collection

```ts
collection: Collection<TResult, TKey, TUtils> & NonSingleResult;
```

Defined in: [useLiveInfiniteQuery.ts:87](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L87)

***

### data

```ts
data: TResult[];
```

Defined in: [useLiveInfiniteQuery.ts:85](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L85)

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [useLiveInfiniteQuery.ts:102](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L102)

#### Returns

`Promise`\<`void`\>

***

### hasNextPage

```ts
hasNextPage: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:103](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L103)

***

### health

```ts
health: HealthNode | undefined;
```

Defined in: [useLiveInfiniteQuery.ts:105](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L105)

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:96](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L96)

***

### isCrashed

```ts
isCrashed: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:95](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L95)

Local storage or an invariant broke. Only a cascade cleanup and a fresh start recover.

***

### isEnabled

```ts
isEnabled: true;
```

Defined in: [useLiveInfiniteQuery.ts:99](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L99)

***

### isFetchingNextPage

```ts
isFetchingNextPage: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:104](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L104)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:91](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L91)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:89](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L89)

***

### isLoadingError

```ts
isLoadingError: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:93](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L93)

The first load failed: there is nothing to show.

***

### isReady

```ts
isReady: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:90](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L90)

***

### isSyncError

```ts
isSyncError: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:98](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L98)

The data is shown, and a sync problem or failed page load is in `health`.

***

### pageParams

```ts
pageParams: number[];
```

Defined in: [useLiveInfiniteQuery.ts:101](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L101)

***

### pages

```ts
pages: TResult[][];
```

Defined in: [useLiveInfiniteQuery.ts:100](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L100)

***

### state

```ts
state: Map<TKey, TResult>;
```

Defined in: [useLiveInfiniteQuery.ts:86](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L86)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [useLiveInfiniteQuery.ts:88](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L88)
