---
id: UseLiveQueryReturn
title: UseLiveQueryReturn
---

Defined in: [useLiveQuery.ts:49](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L49)

Return type for useLiveQuery hook

## Type Parameters

### TContext

`TContext` *extends* `Context`

## Properties

### collection

```ts
collection: ComputedRef<Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, {
}, StandardSchemaV1<unknown, unknown>, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [useLiveQuery.ts:52](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L52)

The underlying query collection instance

***

### data

```ts
data: ComputedRef<InferResultType<TContext>>;
```

Defined in: [useLiveQuery.ts:51](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L51)

Reactive array of query results in order, or single result for findOne queries

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:61](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L61)

True when query has been cleaned up

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:60](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L60)

True when query encountered an error

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:59](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L59)

True when query hasn't started yet

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:54](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L54)

True while initial query data is loading

***

### isPersistedReady

```ts
isPersistedReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:57](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L57)

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:55](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L55)

True when query has received first data and is ready

***

### persistedError

```ts
persistedError: ComputedRef<unknown>;
```

Defined in: [useLiveQuery.ts:58](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L58)

***

### persistedStatus

```ts
persistedStatus: ComputedRef<LiveQueryPersistedStatus>;
```

Defined in: [useLiveQuery.ts:56](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L56)

***

### state

```ts
state: ComputedRef<Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [useLiveQuery.ts:50](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L50)

Reactive Map of query results (key → item)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveQuery.ts:53](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L53)

Current query status
