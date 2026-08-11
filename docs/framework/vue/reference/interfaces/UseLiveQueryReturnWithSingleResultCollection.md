---
id: UseLiveQueryReturnWithSingleResultCollection
title: UseLiveQueryReturnWithSingleResultCollection
---

# Interface: UseLiveQueryReturnWithSingleResultCollection\<T, TKey, TUtils\>

Defined in: [useLiveQuery.ts:71](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L71)

## Type Parameters

### T

`T` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

## Properties

### collection

```ts
collection: ComputedRef<Collection<T, TKey, TUtils, StandardSchemaV1<unknown, unknown>, T> & SingleResult>;
```

Defined in: [useLiveQuery.ts:78](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L78)

***

### data

```ts
data: ComputedRef<T | undefined>;
```

Defined in: [useLiveQuery.ts:77](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L77)

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:84](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L84)

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:83](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L83)

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:82](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L82)

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:80](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L80)

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:81](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L81)

***

### state

```ts
state: ComputedRef<Map<TKey, T>>;
```

Defined in: [useLiveQuery.ts:76](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L76)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveQuery.ts:79](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L79)
