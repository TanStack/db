---
id: UseLiveQueryReturn
title: UseLiveQueryReturn
---

# Interface: UseLiveQueryReturn\<TContext\>

Defined in: [useLiveQuery.ts:40](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L40)

Return type for useLiveQuery hook

## Type Parameters

### TContext

`TContext` *extends* `Context`

## Properties

### collection

```ts
collection: ComputedRef<Collection<{ [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }, string | number, {
}, StandardSchemaV1<unknown, unknown>, { [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }>>;
```

Defined in: [useLiveQuery.ts:43](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L43)

The underlying query collection instance

***

### data

```ts
data: ComputedRef<InferResultType<TContext>>;
```

Defined in: [useLiveQuery.ts:42](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L42)

Reactive array of query results in order, or single result for findOne queries

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:49](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L49)

True when query has been cleaned up

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:48](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L48)

True when query encountered an error

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:47](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L47)

True when query hasn't started yet

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:45](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L45)

True while initial query data is loading

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:46](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L46)

True when query has received first data and is ready

***

### state

```ts
state: ComputedRef<Map<string | number, { [K in string | number | symbol]: (TContext["result"] extends object ? any[any] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]])[K] }>>;
```

Defined in: [useLiveQuery.ts:41](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L41)

Reactive Map of query results (key → item)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveQuery.ts:44](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L44)

Current query status
