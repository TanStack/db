---
id: UseLiveQueryReturnWithSingleResultCollection
title: UseLiveQueryReturnWithSingleResultCollection
---

Defined in: [useLiveQuery.ts:101](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L101)

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

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:117](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L117)

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:116](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L116)

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:115](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L115)

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:110](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L110)

***

### isPersistedReady

```ts
isPersistedReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:113](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L113)

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:111](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L111)

***

### persistedError

```ts
persistedError: ComputedRef<unknown>;
```

Defined in: [useLiveQuery.ts:114](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L114)

***

### persistedStatus

```ts
persistedStatus: ComputedRef<LiveQueryPersistedStatus>;
```

Defined in: [useLiveQuery.ts:112](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L112)

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

Defined in: [useLiveQuery.ts:109](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L109)
