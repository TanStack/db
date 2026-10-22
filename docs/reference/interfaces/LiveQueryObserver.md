---
id: LiveQueryObserver
title: LiveQueryObserver
---

Defined in: [packages/db/src/live-query-observer.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L124)

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

Defined in: [packages/db/src/live-query-observer.ts:148](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L148)

Capture the ordered query result without serializing its source collections.

#### Returns

[`DehydratedLiveQueryResult`](../type-aliases/DehydratedLiveQueryResult.md)\<`T`, `TKey`\>

***

### dispose()

```ts
dispose: () => void;
```

Defined in: [packages/db/src/live-query-observer.ts:150](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L150)

Idempotent teardown.

#### Returns

`void`

***

### getError()

```ts
getError: () => unknown;
```

Defined in: [packages/db/src/live-query-observer.ts:146](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L146)

The transport or preload error for this query, if it has not produced data.

#### Returns

`unknown`

***

### getServerSnapshot()

```ts
getServerSnapshot: () => LiveQuerySnapshot<T, TKey>;
```

Defined in: [packages/db/src/live-query-observer.ts:131](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L131)

Stable server snapshot used by useSyncExternalStore-style adapters.

#### Returns

[`LiveQuerySnapshot`](LiveQuerySnapshot.md)\<`T`, `TKey`\>

***

### getSnapshot()

```ts
getSnapshot: () => LiveQuerySnapshot<T, TKey>;
```

Defined in: [packages/db/src/live-query-observer.ts:129](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L129)

Stable per-revision snapshot for wholesale materialization.

#### Returns

[`LiveQuerySnapshot`](LiveQuerySnapshot.md)\<`T`, `TKey`\>

***

### isInitialRenderReady()

```ts
isInitialRenderReady: () => boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:144](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L144)

Whether a persisted fallback has already passed the network-first gate.

#### Returns

`boolean`

***

### preload()

```ts
preload: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-observer.ts:140](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L140)

Resolve once the collection has loaded its first data.

#### Returns

`Promise`\<`void`\>

***

### preloadForInitialRender()

```ts
preloadForInitialRender: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-observer.ts:142](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L142)

Resolve at network readiness or a permitted persisted fallback.

#### Returns

`Promise`\<`void`\>

***

### subscribe()

```ts
subscribe: (listener) => () => void;
```

Defined in: [packages/db/src/live-query-observer.ts:138](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L138)

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
