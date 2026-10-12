---
id: UseLiveInfiniteQueryReturnWithCollection
title: UseLiveInfiniteQueryReturnWithCollection
---

```ts
type UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils> = object;
```

Defined in: [useLiveInfiniteQuery.ts:81](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L81)

## Type Parameters

### TResult

`TResult` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

## Properties

### collection

```ts
collection: Collection<TResult, TKey, TUtils> & NonSingleResult;
```

Defined in: [useLiveInfiniteQuery.ts:88](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L88)

***

### data

```ts
data: TResult[];
```

Defined in: [useLiveInfiniteQuery.ts:86](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L86)

***

### error

```ts
error: unknown;
```

Defined in: [useLiveInfiniteQuery.ts:104](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L104)

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [useLiveInfiniteQuery.ts:101](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L101)

#### Returns

`Promise`\<`void`\>

***

### hasNextPage

```ts
hasNextPage: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:102](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L102)

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:97](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L97)

***

### isEnabled

```ts
isEnabled: true;
```

Defined in: [useLiveInfiniteQuery.ts:98](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L98)

***

### isError

```ts
isError: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:96](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L96)

***

### isFetchingNextPage

```ts
isFetchingNextPage: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:103](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L103)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:95](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L95)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:90](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L90)

***

### isPersistedReady

```ts
isPersistedReady: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:93](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L93)

***

### isReady

```ts
isReady: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:91](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L91)

***

### pageParams

```ts
pageParams: number[];
```

Defined in: [useLiveInfiniteQuery.ts:100](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L100)

***

### pages

```ts
pages: TResult[][];
```

Defined in: [useLiveInfiniteQuery.ts:99](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L99)

***

### persistedError

```ts
persistedError: unknown | undefined;
```

Defined in: [useLiveInfiniteQuery.ts:94](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L94)

***

### persistedStatus

```ts
persistedStatus: LiveQueryPersistedStatus;
```

Defined in: [useLiveInfiniteQuery.ts:92](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L92)

***

### state

```ts
state: Map<TKey, TResult>;
```

Defined in: [useLiveInfiniteQuery.ts:87](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L87)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [useLiveInfiniteQuery.ts:89](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L89)
