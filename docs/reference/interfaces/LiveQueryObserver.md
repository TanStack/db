---
id: LiveQueryObserver
title: LiveQueryObserver
---

Defined in: [packages/db/src/live-query-observer.ts:117](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L117)

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

Defined in: [packages/db/src/live-query-observer.ts:141](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L141)

Capture the ordered query result without serializing its source collections.

#### Returns

[`DehydratedLiveQueryResult`](../type-aliases/DehydratedLiveQueryResult.md)\<`T`, `TKey`\>

***

### dispose()

```ts
dispose: () => void;
```

Defined in: [packages/db/src/live-query-observer.ts:143](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L143)

Idempotent teardown.

#### Returns

`void`

***

### getError()

```ts
getError: () => unknown;
```

Defined in: [packages/db/src/live-query-observer.ts:139](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L139)

The transport or preload error for this query, if it has not produced data.

#### Returns

`unknown`

***

### getServerSnapshot()

```ts
getServerSnapshot: () => LiveQuerySnapshot<T, TKey>;
```

Defined in: [packages/db/src/live-query-observer.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L124)

Stable server snapshot used by useSyncExternalStore-style adapters.

#### Returns

[`LiveQuerySnapshot`](LiveQuerySnapshot.md)\<`T`, `TKey`\>

***

### getSnapshot()

```ts
getSnapshot: () => LiveQuerySnapshot<T, TKey>;
```

Defined in: [packages/db/src/live-query-observer.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L122)

Stable per-revision snapshot for wholesale materialization.

#### Returns

[`LiveQuerySnapshot`](LiveQuerySnapshot.md)\<`T`, `TKey`\>

***

### isInitialRenderReady()

```ts
isInitialRenderReady: () => boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:137](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L137)

Whether a persisted fallback has already passed the network-first gate.

#### Returns

`boolean`

***

### preload()

```ts
preload: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-observer.ts:133](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L133)

Resolve once the collection has loaded its first data.

#### Returns

`Promise`\<`void`\>

***

### preloadForInitialRender()

```ts
preloadForInitialRender: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-observer.ts:135](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L135)

Resolve at network readiness or a permitted persisted fallback.

#### Returns

`Promise`\<`void`\>

***

### subscribe()

```ts
subscribe: (listener) => () => void;
```

Defined in: [packages/db/src/live-query-observer.ts:131](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L131)

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
