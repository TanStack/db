---
id: UseLiveQueryReturnWithCollection
title: UseLiveQueryReturnWithCollection
---

Defined in: [useLiveQuery.ts:81](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L81)

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

Defined in: [useLiveQuery.ts:88](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L88)

***

### data

```ts
data: ComputedRef<T[]>;
```

Defined in: [useLiveQuery.ts:87](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L87)

***

### state

```ts
state: ComputedRef<Map<TKey, T>>;
```

Defined in: [useLiveQuery.ts:86](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L86)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveQuery.ts:50](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L50)

#### Inherited from

```ts
UseLiveQueryFlags.status
```
