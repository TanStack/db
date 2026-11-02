---
id: UseLiveInfiniteQueryReturn
title: UseLiveInfiniteQueryReturn
---

Defined in: [useLiveInfiniteQuery.ts:35](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L35)

The status and flag refs every `useLiveQuery` result has.

## Extends

- [`UseLiveQueryFlags`](../type-aliases/UseLiveQueryFlags.md)

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

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [useLiveInfiniteQuery.ts:45](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L45)

#### Returns

`Promise`\<`void`\>

***

### hasNextPage

```ts
hasNextPage: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:46](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L46)

***

### isFetchingNextPage

```ts
isFetchingNextPage: ComputedRef<boolean>;
```

Defined in: [useLiveInfiniteQuery.ts:47](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L47)

***

### pageParams

```ts
pageParams: ComputedRef<number[]>;
```

Defined in: [useLiveInfiniteQuery.ts:44](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L44)

***

### pages

```ts
pages: ComputedRef<InferResultType<TContext>[number][][]>;
```

Defined in: [useLiveInfiniteQuery.ts:43](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveInfiniteQuery.ts#L43)

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

Defined in: [useLiveQuery.ts:60](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L60)

#### Inherited from

```ts
UseLiveQueryFlags.status
```
