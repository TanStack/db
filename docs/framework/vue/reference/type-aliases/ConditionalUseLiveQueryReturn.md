---
id: ConditionalUseLiveQueryReturn
title: ConditionalUseLiveQueryReturn
---

```ts
type ConditionalUseLiveQueryReturn<TContext> = Omit<UseLiveQueryReturn<TContext>, "data" | "collection" | "status"> & object;
```

Defined in: [useLiveQuery.ts:66](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L66)

## Type Declaration

### collection

```ts
collection: ComputedRef<
  | Collection<GetResult<TContext>, string | number, {
}>
| null>;
```

### data

```ts
data: ComputedRef<InferConditionalResultType<TContext>>;
```

### status

```ts
status: ComputedRef<CollectionStatus | "disabled">;
```

## Type Parameters

### TContext

`TContext` *extends* `Context`
