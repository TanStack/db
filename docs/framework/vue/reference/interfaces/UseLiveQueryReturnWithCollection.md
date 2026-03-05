---
id: UseLiveQueryReturnWithCollection
title: UseLiveQueryReturnWithCollection
---

# Interface: UseLiveQueryReturnWithCollection\<T, TKey, TUtils\>

Defined in: useLiveQuery.ts:52

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

Defined in: useLiveQuery.ts:59

***

### data

```ts
data: ComputedRef<T[]>;
```

Defined in: useLiveQuery.ts:58

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:65

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:64

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:63

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:61

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:62

***

### state

```ts
state: ComputedRef<Map<TKey, T>>;
```

Defined in: useLiveQuery.ts:57

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: useLiveQuery.ts:60
