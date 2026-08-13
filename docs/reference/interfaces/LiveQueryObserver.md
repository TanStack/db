---
id: LiveQueryObserver
title: LiveQueryObserver
---

# Interface: LiveQueryObserver\<T, TKey\>

Defined in: [packages/db/src/live-query-observer.ts:70](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L70)

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

### dispose()

```ts
dispose: () => void;
```

Defined in: [packages/db/src/live-query-observer.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L86)

Idempotent teardown.

#### Returns

`void`

***

### getSnapshot()

```ts
getSnapshot: () => LiveQuerySnapshot<T, TKey>;
```

Defined in: [packages/db/src/live-query-observer.ts:75](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L75)

Stable per-revision snapshot for wholesale materialization.

#### Returns

[`LiveQuerySnapshot`](LiveQuerySnapshot.md)\<`T`, `TKey`\>

***

### preload()

```ts
preload: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-observer.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L84)

Resolve once the collection has loaded its first data.

#### Returns

`Promise`\<`void`\>

***

### subscribe()

```ts
subscribe: (listener) => () => void;
```

Defined in: [packages/db/src/live-query-observer.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L82)

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
