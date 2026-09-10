---
id: UseLiveQueryReturnWithCollection
title: UseLiveQueryReturnWithCollection
---

# Interface: UseLiveQueryReturnWithCollection\<T, TKey, TUtils\>

Defined in: [useLiveQuery.ts:56](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L56)

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

Defined in: [useLiveQuery.ts:63](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L63)

***

### data

```ts
data: ComputedRef<T[]>;
```

Defined in: [useLiveQuery.ts:62](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L62)

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:69](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L69)

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:68](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L68)

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:67](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L67)

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:65](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L65)

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:66](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L66)

***

### state

```ts
state: ComputedRef<Map<TKey, T>>;
```

Defined in: [useLiveQuery.ts:61](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L61)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveQuery.ts:64](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L64)
