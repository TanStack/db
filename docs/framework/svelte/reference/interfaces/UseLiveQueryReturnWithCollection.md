---
id: UseLiveQueryReturnWithCollection
title: UseLiveQueryReturnWithCollection
---

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:86](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L86)

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

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:94](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L94)

***

### data

```ts
data: TData;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:93](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L93)

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:103](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L103)

***

### isError

```ts
isError: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:102](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L102)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:101](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L101)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:96](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L96)

***

### isPersistedReady

```ts
isPersistedReady: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:99](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L99)

***

### isReady

```ts
isReady: boolean;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:97](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L97)

***

### persistedError

```ts
persistedError: unknown;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:100](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L100)

***

### persistedStatus

```ts
persistedStatus: LiveQueryPersistedStatus;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:98](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L98)

***

### state

```ts
state: Map<TKey, T>;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:92](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L92)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [packages/svelte-db/src/useLiveQuery.svelte.ts:95](https://github.com/TanStack/db/blob/main/packages/svelte-db/src/useLiveQuery.svelte.ts#L95)
