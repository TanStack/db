---
id: ConditionalUseLiveQueryReturn
title: ConditionalUseLiveQueryReturn
---

```ts
type ConditionalUseLiveQueryReturn<T, TData> = Omit<UseLiveQueryReturn<T, TData>, "collection" | "status"> & object;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:68](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L68)

## Type Declaration

### collection

```ts
collection: 
  | Collection<T, string | number, {
}>
  | null;
```

### status

```ts
status: CollectionStatus | "disabled";
```

## Type Parameters

### T

`T` *extends* `object`

### TData

`TData` = `T`[]
