---
id: LiveQueryWindowUpdate
title: LiveQueryWindowUpdate
---

Defined in: [packages/db/src/live-query-window-binding.ts:76](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L76)

Validated infinite-query page shape.

## Extends

- [`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md)

## Properties

### client?

```ts
optional client: DbClient;
```

Defined in: [packages/db/src/live-query-window-binding.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L88)

Hydration identity for a client-backed window.

***

### dependencies?

```ts
optional dependencies: readonly unknown[];
```

Defined in: [packages/db/src/live-query-window-binding.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L84)

The query input's identity dependencies.

***

### initialPageParam

```ts
initialPageParam: number;
```

Defined in: [packages/db/src/live-query-window-binding.ts:40](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L40)

First result-page label, not a server cursor or remote offset.

#### Inherited from

[`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md).[`initialPageParam`](LiveQueryWindowPageShape.md#initialpageparam)

***

### input

```ts
input: unknown;
```

Defined in: [packages/db/src/live-query-window-binding.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L82)

A supplied live-query Collection, or a callback that returns the query.
The binding calls the callback only when it compiles a new window
collection, except in `always` mode, where it calls it on every update.

***

### pageSize

```ts
pageSize: number;
```

Defined in: [packages/db/src/live-query-window-binding.ts:38](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L38)

#### Inherited from

[`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md).[`pageSize`](LiveQueryWindowPageShape.md#pagesize)

***

### queryKey?

```ts
optional queryKey: LiveQueryKey;
```

Defined in: [packages/db/src/live-query-window-binding.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L89)

***

### recompile

```ts
recompile: LiveQueryWindowRecompile;
```

Defined in: [packages/db/src/live-query-window-binding.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L90)

***

### scope?

```ts
optional scope: unknown;
```

Defined in: [packages/db/src/live-query-window-binding.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L86)

Context compared by reference, such as the `DbClient` a query binds to.
