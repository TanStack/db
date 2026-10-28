---
id: UseLiveQueryFlags
title: UseLiveQueryFlags
---

Defined in: [useLiveQuery.ts:57](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L57)

Status, persistence, and error refs every `useLiveQuery` result has.

## Extended by

- [`UseLiveQueryReturn`](UseLiveQueryReturn.md)
- [`UseLiveQueryReturnWithCollection`](UseLiveQueryReturnWithCollection.md)
- [`UseLiveQueryReturnWithSingleResultCollection`](UseLiveQueryReturnWithSingleResultCollection.md)

## Properties

### health

```ts
health: ComputedRef<HealthNode | undefined>;
```

Defined in: [useLiveQuery.ts:69](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L69)

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:66](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L66)

***

### isCrashed

```ts
isCrashed: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:65](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L65)

Local storage or an invariant broke. Only a cascade cleanup and a fresh start recover.

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:61](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L61)

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:59](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L59)

***

### isLoadingError

```ts
isLoadingError: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:63](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L63)

The first load failed: there is nothing to show.

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:60](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L60)

***

### isSyncError

```ts
isSyncError: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:68](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L68)

The data is shown, and a sync problem or failed request is in `health`.

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveQuery.ts:58](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L58)
