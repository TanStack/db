---
id: LiveQueryWindowBinding
title: LiveQueryWindowBinding
---

Defined in: [packages/db/src/live-query-window-binding.ts:93](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L93)

Validated infinite-query page shape.

## Extends

- [`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md)

## Properties

### collection

```ts
collection: Collection<any, any, any>;
```

Defined in: [packages/db/src/live-query-window-binding.ts:98](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L98)

***

### controller

```ts
controller: LiveQueryWindowController<any, any>;
```

Defined in: [packages/db/src/live-query-window-binding.ts:103](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L103)

***

### dependencies

```ts
dependencies: readonly unknown[] | undefined;
```

Defined in: [packages/db/src/live-query-window-binding.ts:96](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L96)

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

### ownsCollection

```ts
ownsCollection: boolean;
```

Defined in: [packages/db/src/live-query-window-binding.ts:102](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L102)

Whether this binding created `collection` from a query.

***

### pageSize

```ts
pageSize: number;
```

Defined in: [packages/db/src/live-query-window-binding.ts:38](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L38)

#### Inherited from

[`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md).[`pageSize`](LiveQueryWindowPageShape.md#pagesize)

***

### queryHash

```ts
queryHash: string | undefined;
```

Defined in: [packages/db/src/live-query-window-binding.ts:100](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L100)

The transport identity of this binding's initial query window.

***

### scope

```ts
scope: unknown;
```

Defined in: [packages/db/src/live-query-window-binding.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L97)

***

### supplied

```ts
supplied: 
  | Collection<any, any, any, StandardSchemaV1<unknown, unknown>, any>
  | undefined;
```

Defined in: [packages/db/src/live-query-window-binding.ts:95](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L95)

The supplied Collection; `undefined` for a query input.

***

### warning

```ts
warning: string | undefined;
```

Defined in: [packages/db/src/live-query-window-binding.ts:108](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L108)

A developer hint about a newly bound supplied collection's window, for the
adapter to print once. Production builds carry none.
