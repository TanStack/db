---
id: UseLiveQueryReturn
title: UseLiveQueryReturn
---

Defined in: [useLiveQuery.ts:65](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L65)

The status and flag refs every `useLiveQuery` result has.

## Extends

- [`UseLiveQueryFlags`](../type-aliases/UseLiveQueryFlags.md)

## Type Parameters

### TContext

`TContext` *extends* `Context`

## Properties

### collection

```ts
collection: ComputedRef<Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, {
}, StandardSchemaV1<unknown, unknown>, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [useLiveQuery.ts:70](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L70)

***

### data

```ts
data: ComputedRef<InferResultType<TContext>>;
```

Defined in: [useLiveQuery.ts:69](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L69)

***

### state

```ts
state: ComputedRef<Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [useLiveQuery.ts:68](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L68)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveQuery.ts:60](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L60)

#### Inherited from

```ts
UseLiveQueryFlags.status
```
