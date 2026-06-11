---
id: InjectLiveQueryResult
title: InjectLiveQueryResult
---

# Interface: InjectLiveQueryResult\<TContext\>

Defined in: [index.ts:32](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L32)

The result of calling `injectLiveQuery`.
Contains reactive signals for the query state and data.

## Type Parameters

### TContext

`TContext` *extends* `Context`

## Properties

### collection

```ts
collection: Signal<
  | Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, {
}, StandardSchemaV1<unknown, unknown>, { [K in string | number | symbol]: ResultValue<TContext>[K] }>
| null>;
```

Defined in: [index.ts:38](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L38)

A signal containing the underlying collection instance (null for disabled queries)

***

### data

```ts
data: Signal<InferResultType<TContext>>;
```

Defined in: [index.ts:36](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L36)

A signal containing the results as an array, or single result for findOne queries

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [index.ts:54](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L54)

A signal indicating whether the collection has been cleaned up

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: [index.ts:52](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L52)

A signal indicating whether the collection has an error

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [index.ts:50](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L50)

A signal indicating whether the collection is idle

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [index.ts:46](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L46)

A signal indicating whether the collection is currently loading

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [index.ts:48](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L48)

A signal indicating whether the collection is ready

***

### state

```ts
state: Signal<Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [index.ts:34](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L34)

A signal containing the complete state map of results keyed by their ID

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [index.ts:44](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L44)

A signal containing the current status of the collection
