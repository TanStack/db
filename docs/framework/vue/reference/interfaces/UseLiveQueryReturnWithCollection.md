---
id: UseLiveQueryReturnWithCollection
title: UseLiveQueryReturnWithCollection
---

Defined in: [useLiveQuery.ts:88](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L88)

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

Defined in: [useLiveQuery.ts:95](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L95)

***

### data

```ts
data: ComputedRef<T[]>;
```

Defined in: [useLiveQuery.ts:94](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L94)

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:104](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L104)

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:103](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L103)

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:102](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L102)

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:97](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L97)

***

### isPersistedReady

```ts
isPersistedReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:100](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L100)

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:98](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L98)

***

### persistedError

```ts
persistedError: ComputedRef<unknown>;
```

Defined in: [useLiveQuery.ts:101](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L101)

***

### persistedStatus

```ts
persistedStatus: ComputedRef<LiveQueryPersistedStatus>;
```

Defined in: [useLiveQuery.ts:99](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L99)

***

### state

```ts
state: ComputedRef<Map<TKey, T>>;
```

Defined in: [useLiveQuery.ts:93](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L93)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveQuery.ts:96](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L96)
