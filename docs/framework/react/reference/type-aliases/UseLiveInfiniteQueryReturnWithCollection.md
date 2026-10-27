---
id: UseLiveInfiniteQueryReturnWithCollection
title: UseLiveInfiniteQueryReturnWithCollection
---

```ts
type UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils> = object;
```

Defined in: [useLiveInfiniteQuery.ts:72](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L72)

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

Defined in: [useLiveInfiniteQuery.ts:79](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L79)

***

### data

```ts
data: TResult[];
```

Defined in: [useLiveInfiniteQuery.ts:77](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L77)

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [useLiveInfiniteQuery.ts:94](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L94)

#### Returns

`Promise`\<`void`\>

***

### hasNextPage

```ts
hasNextPage: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:95](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L95)

***

### health

```ts
health: HealthNode | undefined;
```

Defined in: [useLiveInfiniteQuery.ts:97](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L97)

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:88](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L88)

***

### isCrashed

```ts
isCrashed: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:87](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L87)

Local storage or an invariant broke. Only a cascade cleanup and a fresh start recover.

***

### isEnabled

```ts
isEnabled: true;
```

Defined in: [useLiveInfiniteQuery.ts:91](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L91)

***

### isFetchingNextPage

```ts
isFetchingNextPage: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:96](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L96)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:83](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L83)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:81](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L81)

***

### isLoadingError

```ts
isLoadingError: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:85](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L85)

The first load failed: there is nothing to show.

***

### isReady

```ts
isReady: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:82](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L82)

***

### isSyncError

```ts
isSyncError: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:90](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L90)

The data is shown, and a sync problem or failed page load is in `health`.

***

### pageParams

```ts
pageParams: number[];
```

Defined in: [useLiveInfiniteQuery.ts:93](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L93)

***

### pages

```ts
pages: TResult[][];
```

Defined in: [useLiveInfiniteQuery.ts:92](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L92)

***

### state

```ts
state: Map<TKey, TResult>;
```

Defined in: [useLiveInfiniteQuery.ts:78](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L78)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [useLiveInfiniteQuery.ts:80](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L80)
