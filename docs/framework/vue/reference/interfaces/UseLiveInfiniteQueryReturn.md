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

### error

```ts
error: ComputedRef<unknown>;
```

Defined in: [useLiveInfiniteQuery.ts:70](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L70)

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [useLiveInfiniteQuery.ts:67](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L67)

#### Returns

`Promise`\<`void`\>

***

### hasNextPage

```ts
hasNextPage: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:68](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L68)

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:64](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L64)

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:63](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L63)

***

### isFetchingNextPage

```ts
isFetchingNextPage: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:69](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L69)

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:62](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L62)

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:57](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L57)

***

### isPersistedReady

```ts
isPersistedReady: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:60](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L60)

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:58](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L58)

***

### pageParams

```ts
pageParams: ComputedRef<number[]>;
```

Defined in: [useLiveInfiniteQuery.ts:66](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L66)

***

### pages

```ts
pages: ComputedRef<InferResultType<TContext>[number][][]>;
```

Defined in: [useLiveInfiniteQuery.ts:65](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L65)

***

### persistedError

```ts
persistedError: ComputedRef<unknown>;
```

Defined in: [useLiveInfiniteQuery.ts:61](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L61)

***

### persistedStatus

```ts
persistedStatus: ComputedRef<LiveQueryPersistedStatus>;
```

Defined in: [useLiveInfiniteQuery.ts:59](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L59)

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
