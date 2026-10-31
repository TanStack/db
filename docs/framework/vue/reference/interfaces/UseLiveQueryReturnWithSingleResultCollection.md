---
id: UseLiveQueryReturnWithSingleResultCollection
title: UseLiveQueryReturnWithSingleResultCollection
---

Defined in: [useLiveQuery.ts:101](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L101)

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
collection: ComputedRef<Collection<T, TKey, TUtils, StandardSchemaV1<unknown, unknown>, T> & SingleResult>;
```

Defined in: [useLiveQuery.ts:108](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L108)

***

### data

```ts
data: ComputedRef<T | undefined>;
```

Defined in: [useLiveQuery.ts:107](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L107)

***

### state

```ts
state: ComputedRef<Map<TKey, T>>;
```

Defined in: [useLiveQuery.ts:106](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L106)

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
