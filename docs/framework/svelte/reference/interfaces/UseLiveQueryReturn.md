---
id: UseLiveQueryReturn
title: UseLiveQueryReturn
---

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:61](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L61)

Return type for useLiveQuery hook

## Type Parameters

### T

`T` *extends* `object`

### TData

`TData` = `T`[]

## Properties

### collection

```ts
collection: Collection<T, string | number, {
}>;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:64](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L64)

The underlying query collection instance

***

### data

```ts
data: TData;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:63](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L63)

Reactive array of query results in order, or single item when using findOne()

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:73](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L73)

True when query has been cleaned up

***

### isError

```ts
isError: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:72](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L72)

True when query encountered an error

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:71](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L71)

True when query hasn't started yet

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:66](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L66)

True while initial query data is loading

***

### isPersistedReady

```ts
isPersistedReady: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:69](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L69)

***

### isReady

```ts
isReady: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:67](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L67)

True when query has received first data and is ready

***

### persistedError

```ts
persistedError: unknown;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:70](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L70)

***

### persistedStatus

```ts
persistedStatus: LiveQueryPersistedStatus;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:68](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L68)

***

### state

```ts
state: Map<string | number, T>;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:62](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L62)

Reactive Map of query results (key → item)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:65](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L65)

Current query status
