---
id: LiveQueryWindowUpdate
title: LiveQueryWindowUpdate
---

Defined in: [packages/db/src/live-query-window-binding.ts:72](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L72)

Validated infinite-query page shape.

## Extends

- [`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md)

## Properties

### dependencies?

```ts
optional dependencies: readonly unknown[];
```

Defined in: [packages/db/src/live-query-window-binding.ts:80](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L80)

The query input's identity dependencies.

***

### initialPageParam

```ts
initialPageParam: number;
```

Defined in: [packages/db/src/live-query-window-binding.ts:36](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L36)

First result-page label, not a server cursor or remote offset.

#### Inherited from

[`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md).[`initialPageParam`](LiveQueryWindowPageShape.md#initialpageparam)

***

### input

```ts
input: unknown;
```

Defined in: [packages/db/src/live-query-window-binding.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L78)

A supplied live-query Collection, or a callback that returns the query.
The binding calls the callback only when it compiles a new window
collection, except in `always` mode, where it calls it on every update.

***

### pageSize

```ts
pageSize: number;
```

Defined in: [packages/db/src/live-query-window-binding.ts:34](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L34)

#### Inherited from

[`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md).[`pageSize`](LiveQueryWindowPageShape.md#pagesize)

***

### recompile

```ts
recompile: LiveQueryWindowRecompile;
```

Defined in: [packages/db/src/live-query-window-binding.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L83)

***

### scope?

```ts
optional scope: unknown;
```

Defined in: [packages/db/src/live-query-window-binding.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L82)

Context compared by reference, such as the `DbClient` a query binds to.
