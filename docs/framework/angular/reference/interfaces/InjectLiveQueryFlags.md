---
id: InjectLiveQueryFlags
title: InjectLiveQueryFlags
---

Defined in: [index.ts:42](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L42)

Status, persistence, and health signals every `injectLiveQuery` result has.

## Extended by

- [`InjectLiveQueryResult`](InjectLiveQueryResult.md)
- [`InjectLiveQueryResultWithCollection`](InjectLiveQueryResultWithCollection.md)
- [`InjectLiveQueryResultWithSingleResultCollection`](InjectLiveQueryResultWithSingleResultCollection.md)

## Properties

### health

```ts
health: Signal<HealthNode | undefined>;
```

Defined in: [index.ts:60](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L60)

A signal containing the health tree for the query and its dependencies

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [index.ts:56](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L56)

A signal indicating whether the collection has been cleaned up

***

### isCrashed

```ts
isCrashed: Signal<boolean>;
```

Defined in: [index.ts:54](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L54)

Local storage or an invariant broke. Only a cascade cleanup and a fresh start recover.

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

### isLoadingError

```ts
isLoadingError: Signal<boolean>;
```

Defined in: [index.ts:52](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L52)

The first load failed: there is nothing to show.

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [index.ts:48](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L48)

A signal indicating whether the collection is ready

***

### isSyncError

```ts
isSyncError: Signal<boolean>;
```

Defined in: [index.ts:58](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L58)

The data is shown, and a sync problem or failed request is in `health`.

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [index.ts:44](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L44)

A signal containing the current status of the collection
