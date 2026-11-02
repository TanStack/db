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

Defined in: [packages/db/src/live-query-window-controller.ts:527](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L527)

***

### data

```ts
data: readonly T[];
```

Defined in: [packages/db/src/live-query-window-controller.ts:518](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L518)

Rows across all committed pages, with the peek-ahead row removed.

***

### hasNextPage

```ts
hasNextPage: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:523](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L523)

***

### health

```ts
health: HealthNode | undefined;
```

Defined in: [packages/db/src/live-query-window-controller.ts:539](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L539)

The health tree for the collection and its dependencies, or `undefined` when disabled.

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:534](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L534)

***

### isCrashed

```ts
isCrashed: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:533](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L533)

***

### isEnabled

```ts
isEnabled: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:535](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L535)

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

Defined in: [packages/db/src/live-query-window-controller.ts:531](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L531)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:529](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L529)

***

### isLoadingError

```ts
isLoadingError: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:532](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L532)

***

### isReady

```ts
isReady: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:530](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L530)

***

### isSyncError

```ts
isSyncError: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:537](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L537)

The data is shown, and a sync problem or failed page load is in `health`.

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

### state

```ts
state: ReadonlyMap<TKey, T> | undefined;
```

Defined in: [packages/db/src/live-query-window-controller.ts:526](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L526)

Keyed results for the physical window, or `undefined` when disabled.

***

### status

```ts
status: CollectionStatus | "disabled";
```

Defined in: [packages/db/src/live-query-window-controller.ts:528](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L528)
