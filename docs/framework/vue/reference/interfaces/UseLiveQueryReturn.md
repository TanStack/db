---
id: UseLiveQueryReturn
title: UseLiveQueryReturn
---

# Interface: UseLiveQueryReturn\<T\>

Defined in: useLiveQuery.ts:36

Return type for useLiveQuery hook

## Type Parameters

### T

`T` *extends* `object`

## Properties

### collection

```ts
collection: ComputedRef<Collection<T, string | number, {
}, StandardSchemaV1<unknown, unknown>, T>>;
```

Defined in: useLiveQuery.ts:39

The underlying query collection instance

***

### data

```ts
data: ComputedRef<T[]>;
```

Defined in: useLiveQuery.ts:38

Reactive array of query results in order

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:45

True when query has been cleaned up

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:44

True when query encountered an error

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:43

True when query hasn't started yet

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:41

True while initial query data is loading

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:42

True when query has received first data and is ready

***

### state

```ts
state: ComputedRef<Map<string | number, T>>;
```

Defined in: useLiveQuery.ts:37

Reactive Map of query results (key → item)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: useLiveQuery.ts:40

Current query status
