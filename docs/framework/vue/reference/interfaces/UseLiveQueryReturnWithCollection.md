---
id: UseLiveQueryReturnWithCollection
title: UseLiveQueryReturnWithCollection
---

Defined in: [useLiveQuery.ts:91](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L91)

The status and flag refs every `useLiveQuery` result has.

## Extends

- [`UseLiveQueryFlags`](../type-aliases/UseLiveQueryFlags.md)

## Type Parameters

### T

`T` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

## Properties

### collection

```ts
collection: ComputedRef<Collection<T, TKey, TUtils, StandardSchemaV1<unknown, unknown>, T>>;
```

Defined in: [useLiveQuery.ts:98](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L98)

***

### data

```ts
data: ComputedRef<T[]>;
```

Defined in: [useLiveQuery.ts:97](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L97)

***

### state

```ts
state: ComputedRef<Map<TKey, T>>;
```

Defined in: [useLiveQuery.ts:96](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L96)

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
