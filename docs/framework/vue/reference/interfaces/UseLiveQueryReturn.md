---
id: UseLiveQueryReturn
title: UseLiveQueryReturn
---

# Interface: UseLiveQueryReturn\<T\>

Defined in: [useLiveQuery.ts:36](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L36)

Return type for useLiveQuery hook

## Type Parameters

### T

`T` *extends* `object`

## Properties

### collection

```ts
collection: ComputedRef<Collection<T, string | number, {
}, StandardSchemaV1<unknown, unknown>, T>>;
```

Defined in: [useLiveQuery.ts:39](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L39)

The underlying query collection instance

***

### data

```ts
data: ComputedRef<T[]>;
```

Defined in: [useLiveQuery.ts:38](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L38)

Reactive array of query results in order

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:45](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L45)

True when query has been cleaned up

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:44](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L44)

True when query encountered an error

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:43](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L43)

True when query hasn't started yet

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:41](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L41)

True while initial query data is loading

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:42](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L42)

True when query has received first data and is ready

***

### state

```ts
state: ComputedRef<Map<string | number, T>>;
```

Defined in: [useLiveQuery.ts:37](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L37)

Reactive Map of query results (key → item)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveQuery.ts:40](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L40)

Current query status
