---
id: LiveQueryWindowBinding
title: LiveQueryWindowBinding
---

Defined in: [packages/db/src/live-query-window-binding.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L92)

Validated infinite-query page shape.

## Extends

- [`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md)

## Properties

### collection

```ts
collection: Collection<any, any, any>;
```

Defined in: [packages/db/src/live-query-window-binding.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L97)

***

### controller

```ts
controller: LiveQueryWindowController<any, any>;
```

Defined in: [packages/db/src/live-query-window-binding.ts:102](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L102)

***

### dependencies

```ts
dependencies: readonly unknown[] | undefined;
```

Defined in: [packages/db/src/live-query-window-binding.ts:95](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L95)

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

### ownsCollection

```ts
ownsCollection: boolean;
```

Defined in: [packages/db/src/live-query-window-binding.ts:101](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L101)

Whether this binding created `collection` from a query.

***

### pageSize

```ts
pageSize: number;
```

Defined in: [packages/db/src/live-query-window-binding.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L39)

#### Inherited from

[`LiveQueryWindowPageShape`](LiveQueryWindowPageShape.md).[`pageSize`](LiveQueryWindowPageShape.md#pagesize)

***

### queryHash

```ts
queryHash: string | undefined;
```

Defined in: [packages/db/src/live-query-window-binding.ts:99](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L99)

The transport identity of this binding's initial query window.

***

### scope

```ts
scope: unknown;
```

Defined in: [packages/db/src/live-query-window-binding.ts:96](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L96)

***

### supplied

```ts
supplied: 
  | Collection<any, any, any, StandardSchemaV1<unknown, unknown>, any>
  | undefined;
```

Defined in: [packages/db/src/live-query-window-binding.ts:94](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L94)

The supplied Collection; `undefined` for a query input.

***

### warning

```ts
warning: string | undefined;
```

Defined in: [packages/db/src/live-query-window-binding.ts:107](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L107)

A developer hint about a newly bound supplied collection's window, for the
adapter to print once. Production builds carry none.
