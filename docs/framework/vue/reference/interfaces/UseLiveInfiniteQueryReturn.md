---
id: UseLiveInfiniteQueryReturn
title: UseLiveInfiniteQueryReturn
---

Defined in: [useLiveInfiniteQuery.ts:48](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L48)

## Type Parameters

### TContext

`TContext` *extends* `Context` & `NonSingleResult`

## Properties

### collection

```ts
collection: ComputedRef<Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, UtilsRecord, StandardSchemaV1<unknown, unknown>, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [useLiveInfiniteQuery.ts:53](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L53)

***

### data

```ts
data: ComputedRef<InferResultType<TContext>>;
```

Defined in: [useLiveInfiniteQuery.ts:52](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L52)

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [useLiveInfiniteQuery.ts:69](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L69)

#### Returns

`Promise`\<`void`\>

***

### hasNextPage

```ts
hasNextPage: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:70](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L70)

***

### health

```ts
health: ComputedRef<HealthNode | undefined>;
```

Defined in: [useLiveInfiniteQuery.ts:72](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L72)

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:64](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L64)

***

### isCrashed

```ts
isCrashed: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:63](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L63)

Local storage or an invariant broke. Only a cascade cleanup and a fresh start recover.

***

### isFetchingNextPage

```ts
isFetchingNextPage: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:71](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L71)

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:59](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L59)

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:57](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L57)

***

### isLoadingError

```ts
isLoadingError: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:61](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L61)

The first load failed: there is nothing to show.

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:58](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L58)

***

### isSyncError

```ts
isSyncError: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:66](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L66)

The data is shown, and a sync problem or failed request is in `health`.

***

### pageParams

```ts
pageParams: ComputedRef<number[]>;
```

Defined in: [useLiveInfiniteQuery.ts:68](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L68)

***

### pages

```ts
pages: ComputedRef<InferResultType<TContext>[number][][]>;
```

Defined in: [useLiveInfiniteQuery.ts:67](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L67)

***

### state

```ts
state: ComputedRef<Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [useLiveInfiniteQuery.ts:51](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L51)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveInfiniteQuery.ts:56](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L56)
