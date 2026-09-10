---
id: LiveQueryObserver
title: LiveQueryObserver
---

# Interface: LiveQueryObserver\<T, TKey\>

Defined in: [packages/db/src/live-query-observer.ts:72](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L72)

**`Internal`**

Wraps a resolved live-query `Collection` (or `null` for a disabled query) with
the shared lifecycle every framework adapter needs: start sync on first
subscribe, subscribe to changes and status transitions, expose a stable
snapshot for wholesale consumers, and deliver the raw change set for
granular consumers.

Input resolution (query fn / config / collection / disabled) stays in the
adapter — it is framework-reactive. The observer owns everything after the
input is resolved to a concrete collection.

 Unstable contract for TanStack DB's official framework adapters —
not a public extension point yet; may change in any release.

## Type Parameters

### T

`T` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

## Properties

### dehydrate()

```ts
dehydrate: () => DehydratedLiveQueryResult<T, TKey>;
```

Defined in: [packages/db/src/live-query-observer.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L92)

Capture the ordered query result without serializing its source collections.

#### Returns

[`DehydratedLiveQueryResult`](../type-aliases/DehydratedLiveQueryResult.md)\<`T`, `TKey`\>

***

### dispose()

```ts
dispose: () => void;
```

Defined in: [packages/db/src/live-query-observer.ts:94](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L94)

Idempotent teardown.

#### Returns

`void`

***

### getError()

```ts
getError: () => unknown;
```

Defined in: [packages/db/src/live-query-observer.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L90)

The transport or preload error for this query, if it has not produced data.

#### Returns

`unknown`

***

### getServerSnapshot()

```ts
getServerSnapshot: () => LiveQuerySnapshot<T, TKey>;
```

Defined in: [packages/db/src/live-query-observer.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L79)

Stable server snapshot used by useSyncExternalStore-style adapters.

#### Returns

[`LiveQuerySnapshot`](LiveQuerySnapshot.md)\<`T`, `TKey`\>

***

### getSnapshot()

```ts
getSnapshot: () => LiveQuerySnapshot<T, TKey>;
```

Defined in: [packages/db/src/live-query-observer.ts:77](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L77)

Stable per-revision snapshot for wholesale materialization.

#### Returns

[`LiveQuerySnapshot`](LiveQuerySnapshot.md)\<`T`, `TKey`\>

***

### preload()

```ts
preload: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-observer.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L88)

Resolve once the collection has loaded its first data.

#### Returns

`Promise`\<`void`\>

***

### subscribe()

```ts
subscribe: (listener) => () => void;
```

Defined in: [packages/db/src/live-query-observer.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L86)

Subscribe to changes. The listener receives the change set (or `undefined`
for the synthetic notify a ready collection emits on attach). Granular
adapters apply the changes; wholesale adapters can ignore them and re-read
`getSnapshot()`. Returns an unsubscribe function.

#### Parameters

##### listener

[`LiveQueryObserverListener`](../type-aliases/LiveQueryObserverListener.md)\<`T`, `TKey`\>

#### Returns

```ts
(): void;
```

##### Returns

`void`
