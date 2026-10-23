---
id: UseLiveInfiniteQueryReturnWithCollection
title: UseLiveInfiniteQueryReturnWithCollection
---

Defined in: [useLiveInfiniteQuery.ts:75](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L75)

## Type Parameters

### TResult

`TResult` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

### TUtils

`TUtils` *extends* `UtilsRecord`

## Properties

### collection

```ts
collection: ComputedRef<Collection<TResult, TKey, TUtils, StandardSchemaV1<unknown, unknown>, TResult>>;
```

Defined in: [useLiveInfiniteQuery.ts:82](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L82)

***

### data

```ts
data: ComputedRef<TResult[]>;
```

Defined in: [useLiveInfiniteQuery.ts:81](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L81)

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [useLiveInfiniteQuery.ts:96](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L96)

#### Returns

`Promise`\<`void`\>

***

### hasNextPage

```ts
hasNextPage: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:97](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L97)

***

### health

```ts
health: ComputedRef<HealthNode | undefined>;
```

Defined in: [useLiveInfiniteQuery.ts:99](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L99)

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:91](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L91)

***

### isCrashed

```ts
isCrashed: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:90](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L90)

Local storage or an invariant broke. Only a cascade cleanup and a fresh start recover.

***

### isFetchingNextPage

```ts
isFetchingNextPage: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:98](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L98)

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:86](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L86)

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:84](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L84)

***

### isLoadingError

```ts
isLoadingError: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:88](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L88)

The first load failed: there is nothing to show.

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:85](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L85)

***

### isSyncError

```ts
isSyncError: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:93](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L93)

The data is shown, and a sync problem or failed request is in `health`.

***

### pageParams

```ts
pageParams: ComputedRef<number[]>;
```

Defined in: [useLiveInfiniteQuery.ts:95](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L95)

***

### pages

```ts
pages: ComputedRef<TResult[][]>;
```

Defined in: [useLiveInfiniteQuery.ts:94](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L94)

***

### state

```ts
state: ComputedRef<Map<TKey, TResult>>;
```

Defined in: [useLiveInfiniteQuery.ts:80](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L80)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveInfiniteQuery.ts:83](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L83)
