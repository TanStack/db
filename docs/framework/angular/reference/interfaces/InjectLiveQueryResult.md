---
id: InjectLiveQueryResult
title: InjectLiveQueryResult
---

Defined in: [index.ts:63](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L63)

Status, persistence, and health signals every `injectLiveQuery` result has.

## Extends

- [`InjectLiveQueryFlags`](InjectLiveQueryFlags.md)

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

Defined in: [index.ts:71](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L71)

A signal containing the underlying collection instance (null for disabled queries)

***

### data

```ts
data: Signal<InferResultType<TContext>>;
```

Defined in: [index.ts:69](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L69)

A signal containing the results as an array, or single result for findOne queries

***

### health

```ts
health: Signal<HealthNode | undefined>;
```

Defined in: [index.ts:60](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L60)

A signal containing the health tree for the query and its dependencies

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`health`](InjectLiveQueryFlags.md#health)

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [index.ts:56](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L56)

A signal indicating whether the collection has been cleaned up

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`isCleanedUp`](InjectLiveQueryFlags.md#iscleanedup)

***

### isCrashed

```ts
isCrashed: Signal<boolean>;
```

Defined in: [index.ts:54](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L54)

Local storage or an invariant broke. Only a cascade cleanup and a fresh start recover.

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`isCrashed`](InjectLiveQueryFlags.md#iscrashed)

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [index.ts:50](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L50)

A signal indicating whether the collection is idle

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`isIdle`](InjectLiveQueryFlags.md#isidle)

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [index.ts:46](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L46)

A signal indicating whether the collection is currently loading

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`isLoading`](InjectLiveQueryFlags.md#isloading)

***

### isLoadingError

```ts
isLoadingError: Signal<boolean>;
```

Defined in: [index.ts:52](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L52)

The first load failed: there is nothing to show.

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`isLoadingError`](InjectLiveQueryFlags.md#isloadingerror)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [index.ts:48](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L48)

A signal indicating whether the collection is ready

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`isReady`](InjectLiveQueryFlags.md#isready)

***

### isSyncError

```ts
isSyncError: Signal<boolean>;
```

Defined in: [index.ts:58](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L58)

The data is shown, and a sync problem or failed request is in `health`.

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`isSyncError`](InjectLiveQueryFlags.md#issyncerror)

***

### state

```ts
state: Signal<Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [index.ts:67](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L67)

A signal containing the complete state map of results keyed by their ID

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [index.ts:44](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L44)

A signal containing the current status of the collection

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`status`](InjectLiveQueryFlags.md#status)
