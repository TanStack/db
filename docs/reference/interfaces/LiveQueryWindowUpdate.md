---
id: LiveQueryWindowUpdate
title: LiveQueryWindowUpdate
---

Defined in: packages/db/src/live-query-window-binding.ts:72

Validated infinite-query page shape.

## Extends

- [`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md)

## Properties

### dependencies?

```ts
optional dependencies: readonly unknown[];
```

Defined in: packages/db/src/live-query-window-binding.ts:80

The query input's identity dependencies.

***

### initialPageParam

```ts
initialPageParam: number;
```

Defined in: packages/db/src/live-query-window-binding.ts:36

First result-page label, not a server cursor or remote offset.

#### Inherited from

[`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md).[`initialPageParam`](LiveQueryWindowPageShape.md#initialpageparam)

***

### input

```ts
input: unknown;
```

Defined in: packages/db/src/live-query-window-binding.ts:78

A supplied live-query Collection, or a callback that returns the query.
The binding calls the callback only when it compiles a new window
collection, except in `always` mode, where it calls it on every update.

***

### pageSize

```ts
pageSize: number;
```

Defined in: packages/db/src/live-query-window-binding.ts:34

#### Inherited from

[`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md).[`pageSize`](LiveQueryWindowPageShape.md#pagesize)

***

### recompile

```ts
recompile: LiveQueryWindowRecompile;
```

Defined in: packages/db/src/live-query-window-binding.ts:83

***

### scope?

```ts
optional scope: unknown;
```

Defined in: packages/db/src/live-query-window-binding.ts:82

Context compared by reference, such as the `DbClient` a query binds to.
