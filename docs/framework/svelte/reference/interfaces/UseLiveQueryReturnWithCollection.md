---
id: UseLiveQueryReturnWithCollection
title: UseLiveQueryReturnWithCollection
---

# Interface: UseLiveQueryReturnWithCollection\<T, TKey, TUtils, TData\>

Defined in: useLiveQuery.svelte.ts:45

## Type Parameters

### T

`T` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

### TData

`TData` = `T`[]

## Properties

### collection

```ts
collection: Collection<T, TKey, TUtils>;
```

Defined in: useLiveQuery.svelte.ts:53

***

### data

```ts
data: TData;
```

Defined in: useLiveQuery.svelte.ts:52

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: useLiveQuery.svelte.ts:59

***

### isError

```ts
isError: boolean;
```

Defined in: useLiveQuery.svelte.ts:58

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: useLiveQuery.svelte.ts:57

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: useLiveQuery.svelte.ts:55

***

### isReady

```ts
isReady: boolean;
```

Defined in: useLiveQuery.svelte.ts:56

***

### state

```ts
state: Map<TKey, T>;
```

Defined in: useLiveQuery.svelte.ts:51

***

### status

```ts
status: CollectionStatus;
```

Defined in: useLiveQuery.svelte.ts:54
