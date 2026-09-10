---
id: LiveQuerySnapshot
title: LiveQuerySnapshot
---

# Interface: LiveQuerySnapshot\<T, TKey\>

Defined in: [packages/db/src/live-query-observer.ts:19](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L19)

The canonical, adapter-agnostic view of a live query at a point in time.

`getSnapshot()` returns a stable object identity that only changes when the
query changes, so `useSyncExternalStore`-style consumers can compare by
reference. Each snapshot owns a captured view of `state`/`data`, so reading
an older snapshot cannot expose rows from a later revision.

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

Defined in: [packages/db/src/live-query-observer.ts:28](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L28)

The underlying collection, or `undefined` when disabled.

***

### data

```ts
data: T | readonly T[] | undefined;
```

Defined in: [packages/db/src/live-query-observer.ts:26](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L26)

Ordered results (single row for `findOne`), or `undefined` when disabled.

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:45](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L45)

***

### isEnabled

```ts
isEnabled: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:46](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L46)

***

### isError

```ts
isError: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:44](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L44)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:43](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L43)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:41](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L41)

***

### isReady

```ts
isReady: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:42](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L42)

***

### layoutRevision

```ts
layoutRevision: number;
```

Defined in: [packages/db/src/live-query-observer.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L39)

Monotonic counter bumped whenever the visible layout (the ordered key
sequence) changes — membership, ordering, or an order-only move. Lets
consumers detect a reorder that changed no row value (which `data`/`state`
identity alone can't express once row values are structurally shared).

It is NOT in lockstep with snapshot identity: a value-only update produces a
new snapshot while `layoutRevision` stays put. A `layoutRevision` change
always accompanies a new snapshot, but not vice versa.

***

### state

```ts
state: ReadonlyMap<TKey, T> | undefined;
```

Defined in: [packages/db/src/live-query-observer.ts:24](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L24)

Keyed results, or `undefined` for a disabled query.

***

### status

```ts
status: CollectionStatus | "disabled";
```

Defined in: [packages/db/src/live-query-observer.ts:40](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L40)
