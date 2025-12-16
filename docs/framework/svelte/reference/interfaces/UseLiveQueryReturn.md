---
id: UseLiveQueryReturn
title: UseLiveQueryReturn
---

# Interface: UseLiveQueryReturn\<T\>

Defined in: [useLiveQuery.svelte.ts:29](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L29)

Return type for useLiveQuery hook

## Type Parameters

### T

`T` *extends* `object`

## Properties

### collection

```ts
collection: Collection<T, string | number, {
}>;
```

Defined in: [useLiveQuery.svelte.ts:32](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L32)

The underlying query collection instance

***

### data

```ts
data: T[];
```

Defined in: [useLiveQuery.svelte.ts:31](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L31)

Reactive array of query results in order

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [useLiveQuery.svelte.ts:38](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L38)

True when query has been cleaned up

***

### isError

```ts
isError: boolean;
```

Defined in: [useLiveQuery.svelte.ts:37](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L37)

True when query encountered an error

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [useLiveQuery.svelte.ts:36](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L36)

True when query hasn't started yet

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [useLiveQuery.svelte.ts:34](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L34)

True while initial query data is loading

***

### isReady

```ts
isReady: boolean;
```

Defined in: [useLiveQuery.svelte.ts:35](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L35)

True when query has received first data and is ready

***

### state

```ts
state: Map<string | number, T>;
```

Defined in: [useLiveQuery.svelte.ts:30](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L30)

Reactive Map of query results (key → item)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [useLiveQuery.svelte.ts:33](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L33)

Current query status
