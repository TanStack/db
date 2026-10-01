---
id: UseLiveQueryReturnWithCollection
title: UseLiveQueryReturnWithCollection
---

Defined in: [useLiveQuery.ts:79](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L79)

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

Defined in: [useLiveQuery.ts:86](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L86)

***

### data

```ts
data: ComputedRef<T[]>;
```

Defined in: [useLiveQuery.ts:85](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L85)

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:95](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L95)

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:94](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L94)

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:93](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L93)

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:88](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L88)

***

### isPersistedReady

```ts
isPersistedReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:91](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L91)

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:89](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L89)

***

### persistedError

```ts
persistedError: ComputedRef<unknown>;
```

Defined in: [useLiveQuery.ts:92](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L92)

***

### persistedStatus

```ts
persistedStatus: ComputedRef<LiveQueryPersistedStatus>;
```

Defined in: [useLiveQuery.ts:90](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L90)

***

### state

```ts
state: ComputedRef<Map<TKey, T>>;
```

Defined in: [useLiveQuery.ts:84](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L84)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveQuery.ts:87](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L87)
