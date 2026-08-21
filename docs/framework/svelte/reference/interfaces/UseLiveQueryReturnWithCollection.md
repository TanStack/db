---
id: UseLiveQueryReturnWithCollection
title: UseLiveQueryReturnWithCollection
---

# Interface: UseLiveQueryReturnWithCollection\<T, TKey, TUtils, TData\>

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:59](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L59)

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

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:67](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L67)

***

### data

```ts
data: TData;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:66](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L66)

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:73](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L73)

***

### isError

```ts
isError: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:72](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L72)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:71](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L71)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:69](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L69)

***

### isReady

```ts
isReady: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:70](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L70)

***

### state

```ts
state: Map<TKey, T>;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:65](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L65)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:68](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L68)
