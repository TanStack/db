---
id: InjectLiveQueryResult
title: InjectLiveQueryResult
---

Defined in: [angular-db/src/index.ts:53](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L53)

The status and flag signals every `injectLiveQuery` result has.

## Extends

- [`InjectLiveQueryFlags`](../type-aliases/InjectLiveQueryFlags.md)

## Type Parameters

### TContext

`TContext` *extends* `Context`

## Properties

### collection

```ts
collection: Signal<
  | Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, {
}, StandardSchemaV1<unknown, unknown>, { [K in string | number | symbol]: ResultValue<TContext>[K] }>
| null>;
```

Defined in: [angular-db/src/index.ts:61](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L61)

A signal containing the underlying collection instance (null for disabled queries)

***

### data

```ts
data: Signal<InferResultType<TContext>>;
```

Defined in: [angular-db/src/index.ts:59](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L59)

A signal containing the results as an array, or single result for findOne queries

***

### state

```ts
state: Signal<Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [angular-db/src/index.ts:57](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L57)

A signal containing the complete state map of results keyed by their ID

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [angular-db/src/index.ts:48](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L48)

A signal containing the current status of the collection

#### Inherited from

```ts
InjectLiveQueryFlags.status
```
