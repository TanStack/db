---
id: LiveQueryWindowBinding
title: LiveQueryWindowBinding
---

Defined in: [packages/db/src/live-query-window-binding.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L86)

Validated infinite-query page shape.

## Extends

- [`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md)

## Properties

### collection

```ts
collection: Collection<any, any, any>;
```

Defined in: [packages/db/src/live-query-window-binding.ts:91](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L91)

***

### controller

```ts
controller: LiveQueryWindowController<any, any>;
```

Defined in: [packages/db/src/live-query-window-binding.ts:94](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L94)

***

### dependencies

```ts
dependencies: readonly unknown[] | undefined;
```

Defined in: [packages/db/src/live-query-window-binding.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L89)

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

### ownsCollection

```ts
ownsCollection: boolean;
```

Defined in: [packages/db/src/live-query-window-binding.ts:93](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L93)

Whether this binding created `collection` from a query.

***

### pageSize

```ts
pageSize: number;
```

Defined in: [packages/db/src/live-query-window-binding.ts:34](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L34)

#### Inherited from

[`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md).[`pageSize`](LiveQueryWindowPageShape.md#pagesize)

***

### scope

```ts
scope: unknown;
```

Defined in: [packages/db/src/live-query-window-binding.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L90)

***

### supplied

```ts
supplied: 
  | Collection<any, any, any, StandardSchemaV1<unknown, unknown>, any>
  | undefined;
```

Defined in: [packages/db/src/live-query-window-binding.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L88)

The supplied Collection; `undefined` for a query input.

***

### warning

```ts
warning: string | undefined;
```

Defined in: [packages/db/src/live-query-window-binding.ts:99](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L99)

A developer hint about a newly bound supplied collection's window, for the
adapter to print once. Production builds carry none.
