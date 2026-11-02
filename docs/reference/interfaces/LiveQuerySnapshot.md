---
id: LiveQuerySnapshot
title: LiveQuerySnapshot
---

Defined in: [packages/db/src/live-query-observer.ts:23](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L23)

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

Defined in: [packages/db/src/live-query-observer.ts:32](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L32)

The underlying collection, or `undefined` when disabled.

***

### data

```ts
data: T | readonly T[] | undefined;
```

Defined in: [packages/db/src/live-query-observer.ts:30](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L30)

Ordered results (single row for `findOne`), or `undefined` when disabled.

***

### health

```ts
health: HealthNode | undefined;
```

Defined in: [packages/db/src/live-query-observer.ts:64](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L64)

The health tree for the query and every Collection it depends on, or
`undefined` for a disabled query. After the first ready, a source
problem shows here and the data stays.

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:52](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L52)

***

### isCrashed

```ts
isCrashed: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:51](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L51)

Local storage or an invariant broke. Only a cascade cleanup and a fresh start recover.

***

### isEnabled

```ts
isEnabled: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:53](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L53)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:47](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L47)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:45](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L45)

***

### isLoadingError

```ts
isLoadingError: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:49](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L49)

The first load failed: there is nothing to show.

***

### isReady

```ts
isReady: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:46](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L46)

***

### isSyncError

```ts
isSyncError: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:58](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L58)

The data is shown, and something keeps it from staying current: a sync
problem or a failed request somewhere in `health`.

***

### layoutRevision

```ts
layoutRevision: number;
```

Defined in: [packages/db/src/live-query-observer.ts:43](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L43)

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

Defined in: [packages/db/src/live-query-observer.ts:28](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L28)

Keyed results, or `undefined` for a disabled query.

***

### status

```ts
status: CollectionStatus | "disabled";
```

Defined in: [packages/db/src/live-query-observer.ts:44](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L44)
