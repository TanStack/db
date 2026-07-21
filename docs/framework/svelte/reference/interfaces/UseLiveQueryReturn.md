---
id: UseLiveQueryReturn
title: UseLiveQueryReturn
---

# Interface: UseLiveQueryReturn\<T, TData\>

Defined in: [useLiveQuery.svelte.ts:37](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L37)

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

Defined in: [useLiveQuery.svelte.ts:40](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L40)

The underlying query collection instance

***

### data

```ts
data: TData;
```

Defined in: [useLiveQuery.svelte.ts:39](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L39)

Reactive array of query results in order, or single item when using findOne()

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [useLiveQuery.svelte.ts:46](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L46)

True when query has been cleaned up

***

### isError

```ts
isError: boolean;
```

Defined in: [useLiveQuery.svelte.ts:45](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L45)

True when query encountered an error

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [useLiveQuery.svelte.ts:44](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L44)

True when query hasn't started yet

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [useLiveQuery.svelte.ts:42](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L42)

True while initial query data is loading

***

### isReady

```ts
isReady: boolean;
```

Defined in: [useLiveQuery.svelte.ts:43](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L43)

True when query has received first data and is ready

***

### state

```ts
state: Map<string | number, T>;
```

Defined in: [useLiveQuery.svelte.ts:38](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L38)

Reactive Map of query results (key → item)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [useLiveQuery.svelte.ts:41](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L41)

Current query status
