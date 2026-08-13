---
id: LiveQueryWindowSnapshot
title: LiveQueryWindowSnapshot
---

# Interface: LiveQueryWindowSnapshot\<T, TKey\>

Defined in: [packages/db/src/live-query-window-controller.ts:236](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L236)

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

Defined in: [packages/db/src/live-query-window-controller.ts:252](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L252)

***

### data

```ts
data: readonly T[];
```

Defined in: [packages/db/src/live-query-window-controller.ts:241](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L241)

Rows across all committed pages, with the peek-ahead row removed.

***

### error

```ts
error: unknown;
```

Defined in: [packages/db/src/live-query-window-controller.ts:249](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L249)

The last pagination failure, cleared when a retry begins.

***

### hasNextPage

```ts
hasNextPage: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:246](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L246)

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:258](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L258)

***

### isEnabled

```ts
isEnabled: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:259](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L259)

***

### isError

```ts
isError: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:257](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L257)

***

### isFetchingNextPage

```ts
isFetchingNextPage: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:247](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L247)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:256](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L256)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:254](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L254)

***

### isReady

```ts
isReady: boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:255](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L255)

***

### pageParams

```ts
pageParams: readonly number[];
```

Defined in: [packages/db/src/live-query-window-controller.ts:245](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L245)

`initialPageParam + i` for each committed page.

***

### pages

```ts
pages: readonly readonly T[][];
```

Defined in: [packages/db/src/live-query-window-controller.ts:243](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L243)

Rows grouped into committed pages of `pageSize`.

***

### state

```ts
state: ReadonlyMap<TKey, T> | undefined;
```

Defined in: [packages/db/src/live-query-window-controller.ts:251](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L251)

Keyed results for the physical window, or `undefined` when disabled.

***

### status

```ts
status: CollectionStatus | "disabled";
```

Defined in: [packages/db/src/live-query-window-controller.ts:253](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L253)
