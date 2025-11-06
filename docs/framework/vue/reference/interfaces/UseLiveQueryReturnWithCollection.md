---
id: UseLiveQueryReturnWithCollection
title: UseLiveQueryReturnWithCollection
---

# Interface: UseLiveQueryReturnWithCollection\<T, TKey, TUtils\>

Defined in: useLiveQuery.ts:48

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

Defined in: useLiveQuery.ts:55

***

### data

```ts
data: ComputedRef<T[]>;
```

Defined in: useLiveQuery.ts:54

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:61

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:60

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:59

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:57

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:58

***

### state

```ts
state: ComputedRef<Map<TKey, T>>;
```

Defined in: useLiveQuery.ts:53

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: useLiveQuery.ts:56
