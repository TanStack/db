---
id: UseLiveInfiniteQueryReturnWithCollection
title: UseLiveInfiniteQueryReturnWithCollection
---

```ts
type UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils> = object;
```

Defined in: [useLiveInfiniteQuery.ts:74](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L74)

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

Defined in: [useLiveInfiniteQuery.ts:81](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L81)

***

### data

```ts
data: TResult[];
```

Defined in: [useLiveInfiniteQuery.ts:79](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L79)

***

### error

```ts
error: unknown;
```

Defined in: [useLiveInfiniteQuery.ts:97](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L97)

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [useLiveInfiniteQuery.ts:94](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L94)

#### Returns

`Promise`\<`void`\>

***

### hasNextPage

```ts
hasNextPage: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:95](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L95)

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:90](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L90)

***

### isEnabled

```ts
isEnabled: true;
```

Defined in: [useLiveInfiniteQuery.ts:91](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L91)

***

### isError

```ts
isError: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:89](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L89)

***

### isFetchingNextPage

```ts
isFetchingNextPage: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:96](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L96)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:88](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L88)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:83](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L83)

***

### isPersistedReady

```ts
isPersistedReady: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:86](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L86)

***

### isReady

```ts
isReady: boolean;
```

Defined in: [useLiveInfiniteQuery.ts:84](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L84)

***

### pageParams

```ts
pageParams: number[];
```

Defined in: [useLiveInfiniteQuery.ts:93](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L93)

***

### pages

```ts
pages: TResult[][];
```

Defined in: [useLiveInfiniteQuery.ts:92](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L92)

***

### persistedError

```ts
persistedError: unknown | undefined;
```

Defined in: [useLiveInfiniteQuery.ts:87](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L87)

***

### persistedStatus

```ts
persistedStatus: LiveQueryPersistedStatus;
```

Defined in: [useLiveInfiniteQuery.ts:85](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L85)

***

### state

```ts
state: Map<TKey, TResult>;
```

Defined in: [useLiveInfiniteQuery.ts:80](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L80)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [useLiveInfiniteQuery.ts:82](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveInfiniteQuery.ts#L82)
