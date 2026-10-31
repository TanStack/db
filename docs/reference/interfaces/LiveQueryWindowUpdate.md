---
id: LiveQueryWindowUpdate
title: LiveQueryWindowUpdate
---

Defined in: [packages/db/src/live-query-window-binding.ts:75](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L75)

Validated infinite-query page shape.

## Extends

- [`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md)

## Properties

### client?

```ts
optional client: DbClient;
```

Defined in: [packages/db/src/live-query-window-binding.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L87)

Hydration identity for a client-backed window.

***

### dependencies?

```ts
optional dependencies: readonly unknown[];
```

Defined in: [packages/db/src/live-query-window-binding.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L83)

The query input's identity dependencies.

***

### initialPageParam

```ts
initialPageParam: number;
```

Defined in: [packages/db/src/live-query-window-binding.ts:41](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L41)

First result-page label, not a server cursor or remote offset.

#### Inherited from

[`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md).[`initialPageParam`](LiveQueryWindowPageShape.md#initialpageparam)

***

### input

```ts
input: unknown;
```

Defined in: [packages/db/src/live-query-window-binding.ts:81](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L81)

A supplied live-query Collection, or a callback that returns the query.
The binding calls the callback only when it compiles a new window
collection, except in `always` mode, where it calls it on every update.

***

### pageSize

```ts
pageSize: number;
```

Defined in: [packages/db/src/live-query-window-binding.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L39)

#### Inherited from

[`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md).[`pageSize`](LiveQueryWindowPageShape.md#pagesize)

***

### queryKey?

```ts
optional queryKey: LiveQueryKey;
```

Defined in: [packages/db/src/live-query-window-binding.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L88)

***

### recompile

```ts
recompile: LiveQueryWindowRecompile;
```

Defined in: [packages/db/src/live-query-window-binding.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L89)

***

### scope?

```ts
optional scope: unknown;
```

Defined in: [packages/db/src/live-query-window-binding.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L85)

Context compared by reference, such as the `DbClient` a query binds to.
