---
id: UseLiveQueryReturn
title: UseLiveQueryReturn
---

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:64](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L64)

Return type for useLiveQuery hook

## Extends

- `LiveQueryStatusFlags`

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

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:70](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L70)

The underlying query collection instance

***

### data

```ts
data: TData;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:69](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L69)

Reactive array of query results in order, or single item when using findOne()

***

### state

```ts
state: Map<string | number, T>;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:68](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L68)

Reactive Map of query results (key → item)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:71](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L71)

Current query status
