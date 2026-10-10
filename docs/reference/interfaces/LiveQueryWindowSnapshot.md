---
id: LiveQueryWindowSnapshot
title: LiveQueryWindowSnapshot
---

Defined in: [packages/db/src/live-query-window-controller.ts:513](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L513)

**`Internal`**

A page-windowed view of a live query at a point in time.

 This contract is unstable while RFC #1623 is being implemented.

## Type Parameters

### T

`T` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

## Properties

### collection

```ts
collection: 
  | Collection<T, TKey, any, StandardSchemaV1<unknown, unknown>, T>
  | undefined;
```

Defined in: [packages/db/src/live-query-window-controller.ts:529](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L529)

***

### data

```ts
data: readonly T[];
```

Defined in: [packages/db/src/live-query-window-controller.ts:518](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L518)

Rows across all committed pages, with the peek-ahead row removed.

***

### error

```ts
error: unknown;
```

Defined in: [packages/db/src/live-query-window-controller.ts:526](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L526)

Last pagination failure, retained through an earlier-started success until recovery begins.

***

### hasNextPage

```ts
hasNextPage: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:523](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L523)

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:538](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L538)

***

### isEnabled

```ts
isEnabled: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:539](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L539)

***

### isError

```ts
isError: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:537](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L537)

***

### isFetchingNextPage

```ts
isFetchingNextPage: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:524](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L524)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:536](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L536)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:531](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L531)

***

### isPersistedReady

```ts
isPersistedReady: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:534](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L534)

***

### isReady

```ts
isReady: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:532](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L532)

***

### pageParams

```ts
pageParams: readonly number[];
```

Defined in: [packages/db/src/live-query-window-controller.ts:522](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L522)

`initialPageParam + i` for each committed page.

***

### pages

```ts
pages: readonly readonly T[][];
```

Defined in: [packages/db/src/live-query-window-controller.ts:520](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L520)

Rows grouped into committed pages of `pageSize`.

***

### persistedError

```ts
persistedError: unknown;
```

Defined in: [packages/db/src/live-query-window-controller.ts:535](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L535)

***

### persistedStatus

```ts
persistedStatus: LiveQueryPersistedStatus;
```

Defined in: [packages/db/src/live-query-window-controller.ts:533](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L533)

***

### state

```ts
state: ReadonlyMap<TKey, T> | undefined;
```

Defined in: [packages/db/src/live-query-window-controller.ts:528](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L528)

Keyed results for the physical window, or `undefined` when disabled.

***

### status

```ts
status: CollectionStatus | "disabled";
```

Defined in: [packages/db/src/live-query-window-controller.ts:530](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L530)
