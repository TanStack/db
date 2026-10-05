---
id: UseLiveQueryReturnWithCollection
title: UseLiveQueryReturnWithCollection
---

Defined in: [useLiveQuery.ts:82](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L82)

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

Defined in: [useLiveQuery.ts:89](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L89)

***

### data

```ts
data: ComputedRef<T[]>;
```

Defined in: [useLiveQuery.ts:88](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L88)

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:98](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L98)

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:97](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L97)

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:96](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L96)

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:91](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L91)

***

### isPersistedReady

```ts
isPersistedReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:94](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L94)

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:92](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L92)

***

### persistedError

```ts
persistedError: ComputedRef<unknown>;
```

Defined in: [useLiveQuery.ts:95](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L95)

***

### persistedStatus

```ts
persistedStatus: ComputedRef<LiveQueryPersistedStatus>;
```

Defined in: [useLiveQuery.ts:93](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L93)

***

### state

```ts
state: ComputedRef<Map<TKey, T>>;
```

Defined in: [useLiveQuery.ts:87](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L87)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveQuery.ts:90](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L90)
