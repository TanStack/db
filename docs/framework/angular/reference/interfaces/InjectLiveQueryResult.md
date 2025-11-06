---
id: InjectLiveQueryResult
title: InjectLiveQueryResult
---

# Interface: InjectLiveQueryResult\<TResult, TKey, TUtils\>

Defined in: index.ts:26

The result of calling `injectLiveQuery`.
Contains reactive signals for the query state and data.

## Type Parameters

### TResult

`TResult` *extends* `object` = `any`

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\> = \{
\}

## Properties

### collection

```ts
collection: Signal<Collection<TResult, TKey, TUtils, StandardSchemaV1<unknown, unknown>, TResult>>;
```

Defined in: index.ts:36

A signal containing the underlying collection instance

***

### data

```ts
data: Signal<TResult[]>;
```

Defined in: index.ts:34

A signal containing the results as an array

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: index.ts:48

A signal indicating whether the collection has been cleaned up

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: index.ts:46

A signal indicating whether the collection has an error

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: index.ts:44

A signal indicating whether the collection is idle

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: index.ts:40

A signal indicating whether the collection is currently loading

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: index.ts:42

A signal indicating whether the collection is ready

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: index.ts:32

A signal containing the complete state map of results keyed by their ID

***

### status

```ts
status: Signal<CollectionStatus>;
```

Defined in: index.ts:38

A signal containing the current status of the collection
