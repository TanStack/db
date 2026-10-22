---
id: InjectLiveQueryResult
title: InjectLiveQueryResult
---

Defined in: [index.ts:41](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L41)

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

Defined in: [index.ts:47](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L47)

A signal containing the underlying collection instance (null for disabled queries)

***

### data

```ts
data: Signal<InferResultType<TContext>>;
```

Defined in: [index.ts:45](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L45)

A signal containing the results as an array, or single result for findOne queries

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [index.ts:66](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L66)

A signal indicating whether the collection has been cleaned up

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: [index.ts:64](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L64)

A signal indicating whether the collection has an error

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [index.ts:62](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L62)

A signal indicating whether the collection is idle

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [index.ts:55](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L55)

A signal indicating whether the collection is currently loading

***

### isPersistedReady

```ts
isPersistedReady: Signal<boolean>;
```

Defined in: [index.ts:59](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L59)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [index.ts:57](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L57)

A signal indicating whether the collection is ready

***

### persistedError

```ts
persistedError: Signal<unknown>;
```

Defined in: [index.ts:60](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L60)

***

### persistedStatus

```ts
persistedStatus: Signal<LiveQueryPersistedStatus>;
```

Defined in: [index.ts:58](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L58)

***

### state

```ts
state: Signal<Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [index.ts:43](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L43)

A signal containing the complete state map of results keyed by their ID

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [index.ts:53](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L53)

A signal containing the current status of the collection
