---
id: UseLiveInfiniteQueryReturn
title: UseLiveInfiniteQueryReturn
---

Defined in: [useLiveInfiniteQuery.ts:47](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L47)

## Type Parameters

### TContext

`TContext` *extends* `Context` & `NonSingleResult`

## Properties

### collection

```ts
collection: ComputedRef<Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, UtilsRecord, StandardSchemaV1<unknown, unknown>, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [useLiveInfiniteQuery.ts:52](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L52)

***

### data

```ts
data: ComputedRef<InferResultType<TContext>>;
```

Defined in: [useLiveInfiniteQuery.ts:51](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L51)

***

### error

```ts
error: ComputedRef<unknown>;
```

Defined in: [useLiveInfiniteQuery.ts:66](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L66)

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [useLiveInfiniteQuery.ts:63](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L63)

#### Returns

`Promise`\<`void`\>

***

### hasNextPage

```ts
hasNextPage: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:64](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L64)

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:60](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L60)

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:59](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L59)

***

### isFetchingNextPage

```ts
isFetchingNextPage: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:65](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L65)

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:58](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L58)

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:56](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L56)

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:57](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L57)

***

### pageParams

```ts
pageParams: ComputedRef<number[]>;
```

Defined in: [useLiveInfiniteQuery.ts:62](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L62)

***

### pages

```ts
pages: ComputedRef<InferResultType<TContext>[number][][]>;
```

Defined in: [useLiveInfiniteQuery.ts:61](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L61)

***

### state

```ts
state: ComputedRef<Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [useLiveInfiniteQuery.ts:50](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L50)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveInfiniteQuery.ts:55](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L55)
