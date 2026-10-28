---
id: LiveQuerySnapshot
title: LiveQuerySnapshot
---

Defined in: [packages/db/src/live-query-observer.ts:26](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L26)

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

Defined in: [packages/db/src/live-query-observer.ts:35](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L35)

The underlying collection, or `undefined` when disabled.

***

### data

```ts
data: T | readonly T[] | undefined;
```

Defined in: [packages/db/src/live-query-observer.ts:33](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L33)

Ordered results (single row for `findOne`), or `undefined` when disabled.

***

### health

```ts
health: HealthNode | undefined;
```

Defined in: [packages/db/src/live-query-observer.ts:67](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L67)

The health tree for the query and every Collection it depends on, or
`undefined` for a disabled query. After the first ready, a source
problem shows here and the data stays.

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:55](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L55)

***

### isCrashed

```ts
isCrashed: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:54](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L54)

Local storage or an invariant broke. Only a cascade cleanup and a fresh start recover.

***

### isEnabled

```ts
isEnabled: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:56](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L56)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:50](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L50)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:48](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L48)

***

### isLoadingError

```ts
isLoadingError: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:52](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L52)

The first load failed: there is nothing to show.

***

### isReady

```ts
isReady: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:49](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L49)

***

### isSyncError

```ts
isSyncError: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:61](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L61)

The data is shown, and something keeps it from staying current: a sync
problem or a failed request somewhere in `health`.

***

### layoutRevision

```ts
layoutRevision: number;
```

Defined in: [packages/db/src/live-query-observer.ts:46](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L46)

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

Defined in: [packages/db/src/live-query-observer.ts:31](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L31)

Keyed results, or `undefined` for a disabled query.

***

### status

```ts
status: CollectionStatus | "disabled";
```

Defined in: [packages/db/src/live-query-observer.ts:47](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L47)
