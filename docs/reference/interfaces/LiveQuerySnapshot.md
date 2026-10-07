---
id: LiveQuerySnapshot
title: LiveQuerySnapshot
---

Defined in: [packages/db/src/live-query-observer.ts:66](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L66)

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

Defined in: [packages/db/src/live-query-observer.ts:75](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L75)

The underlying collection, or `undefined` when disabled.

***

### data

```ts
data: T | readonly T[] | undefined;
```

Defined in: [packages/db/src/live-query-observer.ts:73](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L73)

Ordered results (single row for `findOne`), or `undefined` when disabled.

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:96](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L96)

***

### isEnabled

```ts
isEnabled: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L97)

***

### isError

```ts
isError: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:95](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L95)

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:94](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L94)

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L88)

***

### isPersistedReady

```ts
isPersistedReady: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L92)

***

### isReady

```ts
isReady: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L89)

***

### layoutRevision

```ts
layoutRevision: number;
```

Defined in: [packages/db/src/live-query-observer.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L86)

Monotonic counter bumped whenever the visible layout (the ordered key
sequence) changes — membership, ordering, or an order-only move. Lets
consumers detect a reorder that changed no row value (which `data`/`state`
identity alone can't express once row values are structurally shared).

It is NOT in lockstep with snapshot identity: a value-only update produces a
new snapshot while `layoutRevision` stays put. A `layoutRevision` change
always accompanies a new snapshot, but not vice versa.

***

### persistedError

```ts
persistedError: unknown;
```

Defined in: [packages/db/src/live-query-observer.ts:93](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L93)

***

### persistedStatus

```ts
persistedStatus: LiveQueryPersistedStatus;
```

Defined in: [packages/db/src/live-query-observer.ts:91](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L91)

Persisted restore is separate from upstream/Collection readiness.

***

### state

```ts
state: ReadonlyMap<TKey, T> | undefined;
```

Defined in: [packages/db/src/live-query-observer.ts:71](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L71)

Keyed results, or `undefined` for a disabled query.

***

### status

```ts
status: CollectionStatus | "disabled";
```

Defined in: [packages/db/src/live-query-observer.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L87)
