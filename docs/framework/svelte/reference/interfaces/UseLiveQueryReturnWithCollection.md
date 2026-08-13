---
id: UseLiveQueryReturnWithCollection
title: UseLiveQueryReturnWithCollection
---

# Interface: UseLiveQueryReturnWithCollection\<T, TKey, TUtils, TData\>

Defined in: [useLiveQuery.svelte.ts:51](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L51)

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

Defined in: [useLiveQuery.svelte.ts:59](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L59)

***

### data

```ts
data: TData;
```

Defined in: [useLiveQuery.svelte.ts:58](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L58)

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [useLiveQuery.svelte.ts:65](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L65)

***

### isError

```ts
isError: boolean;
```

Defined in: [useLiveQuery.svelte.ts:64](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L64)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [useLiveQuery.svelte.ts:63](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L63)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [useLiveQuery.svelte.ts:61](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L61)

***

### isReady

```ts
isReady: boolean;
```

Defined in: [useLiveQuery.svelte.ts:62](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L62)

***

### state

```ts
state: Map<TKey, T>;
```

Defined in: [useLiveQuery.svelte.ts:57](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L57)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [useLiveQuery.svelte.ts:60](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L60)
