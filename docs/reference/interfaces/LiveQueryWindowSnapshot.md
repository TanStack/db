---
id: LiveQueryWindowSnapshot
title: LiveQueryWindowSnapshot
---

# Interface: LiveQueryWindowSnapshot\<T, TKey\>

Defined in: [packages/db/src/live-query-window-controller.ts:474](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L474)

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

Defined in: [packages/db/src/live-query-window-controller.ts:490](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L490)

***

### data

```ts
data: readonly T[];
```

Defined in: [packages/db/src/live-query-window-controller.ts:479](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L479)

Rows across all committed pages, with the peek-ahead row removed.

***

### error

```ts
error: unknown;
```

Defined in: [packages/db/src/live-query-window-controller.ts:487](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L487)

The last pagination failure, cleared when a retry begins.

***

### hasNextPage

```ts
hasNextPage: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:484](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L484)

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:496](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L496)

***

### isEnabled

```ts
isEnabled: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:497](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L497)

***

### isError

```ts
isError: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:495](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L495)

***

### isFetchingNextPage

```ts
isFetchingNextPage: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:485](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L485)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:494](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L494)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:492](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L492)

***

### isReady

```ts
isReady: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:493](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L493)

***

### pageParams

```ts
pageParams: readonly number[];
```

Defined in: [packages/db/src/live-query-window-controller.ts:483](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L483)

`initialPageParam + i` for each committed page.

***

### pages

```ts
pages: readonly readonly T[][];
```

Defined in: [packages/db/src/live-query-window-controller.ts:481](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L481)

Rows grouped into committed pages of `pageSize`.

***

### state

```ts
state: ReadonlyMap<TKey, T> | undefined;
```

Defined in: [packages/db/src/live-query-window-controller.ts:489](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L489)

Keyed results for the physical window, or `undefined` when disabled.

***

### status

```ts
status: CollectionStatus | "disabled";
```

Defined in: [packages/db/src/live-query-window-controller.ts:491](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L491)
