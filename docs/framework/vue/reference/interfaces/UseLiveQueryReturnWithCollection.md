---
id: UseLiveQueryReturnWithCollection
title: UseLiveQueryReturnWithCollection
---

# Interface: UseLiveQueryReturnWithCollection\<T, TKey, TUtils\>

Defined in: [useLiveQuery.ts:52](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L52)

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

Defined in: [useLiveQuery.ts:59](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L59)

***

### data

```ts
data: ComputedRef<T[]>;
```

Defined in: [useLiveQuery.ts:58](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L58)

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:65](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L65)

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:64](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L64)

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:63](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L63)

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:61](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L61)

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:62](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L62)

***

### state

```ts
state: ComputedRef<Map<TKey, T>>;
```

Defined in: [useLiveQuery.ts:57](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L57)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveQuery.ts:60](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L60)
