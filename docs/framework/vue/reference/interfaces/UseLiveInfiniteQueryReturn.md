---
id: UseLiveInfiniteQueryReturn
title: UseLiveInfiniteQueryReturn
---

Defined in: [useLiveInfiniteQuery.ts:35](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L35)

## Type Parameters

### TContext

`TContext` *extends* `Context` & `NonSingleResult`

## Properties

### collection

```ts
collection: ComputedRef<Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, UtilsRecord, StandardSchemaV1<unknown, unknown>, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [useLiveInfiniteQuery.ts:40](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L40)

***

### data

```ts
data: ComputedRef<InferResultType<TContext>>;
```

Defined in: [useLiveInfiniteQuery.ts:39](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L39)

***

### error

```ts
error: ComputedRef<unknown>;
```

Defined in: [useLiveInfiniteQuery.ts:57](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L57)

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [useLiveInfiniteQuery.ts:54](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L54)

#### Returns

`Promise`\<`void`\>

***

### hasNextPage

```ts
hasNextPage: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:55](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L55)

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:51](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L51)

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:50](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L50)

***

### isFetchingNextPage

```ts
isFetchingNextPage: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:56](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L56)

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:49](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L49)

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:44](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L44)

***

### isPersistedReady

```ts
isPersistedReady: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:47](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L47)

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:45](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L45)

***

### pageParams

```ts
pageParams: ComputedRef<number[]>;
```

Defined in: [useLiveInfiniteQuery.ts:53](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L53)

***

### pages

```ts
pages: ComputedRef<InferResultType<TContext>[number][][]>;
```

Defined in: [useLiveInfiniteQuery.ts:52](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L52)

***

### persistedError

```ts
persistedError: ComputedRef<unknown>;
```

Defined in: [useLiveInfiniteQuery.ts:48](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L48)

***

### persistedStatus

```ts
persistedStatus: ComputedRef<LiveQueryPersistedStatus>;
```

Defined in: [useLiveInfiniteQuery.ts:46](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L46)

***

### state

```ts
state: ComputedRef<Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [useLiveInfiniteQuery.ts:38](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L38)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveInfiniteQuery.ts:43](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L43)
