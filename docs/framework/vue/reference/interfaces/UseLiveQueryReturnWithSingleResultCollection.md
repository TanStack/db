---
id: UseLiveQueryReturnWithSingleResultCollection
title: UseLiveQueryReturnWithSingleResultCollection
---

# Interface: UseLiveQueryReturnWithSingleResultCollection\<T, TKey, TUtils\>

Defined in: useLiveQuery.ts:68

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

Defined in: useLiveQuery.ts:75

***

### data

```ts
data: ComputedRef<T | undefined>;
```

Defined in: useLiveQuery.ts:74

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:81

***

### isError

```ts
isError: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:80

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:79

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:77

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: useLiveQuery.ts:78

***

### state

```ts
state: ComputedRef<Map<TKey, T>>;
```

Defined in: useLiveQuery.ts:73

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: useLiveQuery.ts:76
