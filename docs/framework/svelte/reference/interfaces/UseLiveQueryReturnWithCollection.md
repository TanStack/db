---
id: UseLiveQueryReturnWithCollection
title: UseLiveQueryReturnWithCollection
---

# Interface: UseLiveQueryReturnWithCollection\<T, TKey, TUtils, TData\>

Defined in: [useLiveQuery.svelte.ts:45](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L45)

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

Defined in: [useLiveQuery.svelte.ts:53](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L53)

***

### data

```ts
data: TData;
```

Defined in: [useLiveQuery.svelte.ts:52](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L52)

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [useLiveQuery.svelte.ts:59](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L59)

***

### isError

```ts
isError: boolean;
```

Defined in: [useLiveQuery.svelte.ts:58](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L58)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [useLiveQuery.svelte.ts:57](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L57)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [useLiveQuery.svelte.ts:55](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L55)

***

### isReady

```ts
isReady: boolean;
```

Defined in: [useLiveQuery.svelte.ts:56](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L56)

***

### state

```ts
state: Map<TKey, T>;
```

Defined in: [useLiveQuery.svelte.ts:51](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L51)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [useLiveQuery.svelte.ts:54](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L54)
