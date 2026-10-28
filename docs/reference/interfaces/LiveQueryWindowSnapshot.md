---
id: LiveQueryWindowSnapshot
title: LiveQueryWindowSnapshot
---

Defined in: [packages/db/src/live-query-window-controller.ts:510](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L510)

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

Defined in: [packages/db/src/live-query-window-controller.ts:524](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L524)

***

### data

```ts
data: readonly T[];
```

Defined in: [packages/db/src/live-query-window-controller.ts:515](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L515)

Rows across all committed pages, with the peek-ahead row removed.

***

### hasNextPage

```ts
hasNextPage: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:520](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L520)

***

### health

```ts
health: HealthNode | undefined;
```

Defined in: [packages/db/src/live-query-window-controller.ts:536](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L536)

The health tree for the collection and its dependencies, or `undefined` when disabled.

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:531](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L531)

***

### isCrashed

```ts
isCrashed: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:530](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L530)

***

### isEnabled

```ts
isEnabled: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:532](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L532)

***

### isFetchingNextPage

```ts
isFetchingNextPage: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:521](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L521)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:528](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L528)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:526](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L526)

***

### isLoadingError

```ts
isLoadingError: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:529](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L529)

***

### isReady

```ts
isReady: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:527](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L527)

***

### isSyncError

```ts
isSyncError: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:534](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L534)

The data is shown, and a sync problem or failed page load is in `health`.

***

### pageParams

```ts
pageParams: readonly number[];
```

Defined in: [packages/db/src/live-query-window-controller.ts:519](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L519)

`initialPageParam + i` for each committed page.

***

### pages

```ts
pages: readonly readonly T[][];
```

Defined in: [packages/db/src/live-query-window-controller.ts:517](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L517)

Rows grouped into committed pages of `pageSize`.

***

### state

```ts
state: ReadonlyMap<TKey, T> | undefined;
```

Defined in: [packages/db/src/live-query-window-controller.ts:523](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L523)

Keyed results for the physical window, or `undefined` when disabled.

***

### status

```ts
status: CollectionStatus | "disabled";
```

Defined in: [packages/db/src/live-query-window-controller.ts:525](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L525)
