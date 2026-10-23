---
id: InjectLiveQueryResult
title: InjectLiveQueryResult
---

Defined in: [angular-db/src/index.ts:42](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L42)

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

Defined in: [angular-db/src/index.ts:48](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L48)

A signal containing the underlying collection instance (null for disabled queries)

***

### data

```ts
data: Signal<InferResultType<TContext>>;
```

Defined in: [angular-db/src/index.ts:46](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L46)

A signal containing the results as an array, or single result for findOne queries

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:67](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L67)

A signal indicating whether the collection has been cleaned up

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:65](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L65)

A signal indicating whether the collection has an error

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:63](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L63)

A signal indicating whether the collection is idle

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:56](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L56)

A signal indicating whether the collection is currently loading

***

### isPersistedReady

```ts
isPersistedReady: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:60](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L60)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:58](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L58)

A signal indicating whether the collection is ready

***

### persistedError

```ts
persistedError: Signal<unknown>;
```

Defined in: [angular-db/src/index.ts:61](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L61)

***

### persistedStatus

```ts
persistedStatus: Signal<LiveQueryPersistedStatus>;
```

Defined in: [angular-db/src/index.ts:59](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L59)

***

### state

```ts
state: Signal<Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [angular-db/src/index.ts:44](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L44)

A signal containing the complete state map of results keyed by their ID

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [angular-db/src/index.ts:54](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L54)

A signal containing the current status of the collection
