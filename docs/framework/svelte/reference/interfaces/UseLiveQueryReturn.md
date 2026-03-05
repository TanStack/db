---
id: UseLiveQueryReturn
title: UseLiveQueryReturn
---

# Interface: UseLiveQueryReturn\<T, TData\>

Defined in: useLiveQuery.svelte.ts:33

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

Defined in: useLiveQuery.svelte.ts:36

The underlying query collection instance

***

### data

```ts
data: TData;
```

Defined in: useLiveQuery.svelte.ts:35

Reactive array of query results in order, or single item when using findOne()

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: useLiveQuery.svelte.ts:42

True when query has been cleaned up

***

### isError

```ts
isError: boolean;
```

Defined in: useLiveQuery.svelte.ts:41

True when query encountered an error

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: useLiveQuery.svelte.ts:40

True when query hasn't started yet

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: useLiveQuery.svelte.ts:38

True while initial query data is loading

***

### isReady

```ts
isReady: boolean;
```

Defined in: useLiveQuery.svelte.ts:39

True when query has received first data and is ready

***

### state

```ts
state: Map<string | number, T>;
```

Defined in: useLiveQuery.svelte.ts:34

Reactive Map of query results (key → item)

***

### status

```ts
status: CollectionStatus;
```

Defined in: useLiveQuery.svelte.ts:37

Current query status
