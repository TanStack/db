---
id: PersistedReadinessSource
title: PersistedReadinessSource
---

Defined in: [packages/db/src/persisted-readiness.ts:10](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L10)

**`Internal`**

Capability supplied by a persistence adapter, not by core sync.

## Properties

### getOrStartNetworkDeadline()

```ts
getOrStartNetworkDeadline: () => number;
```

Defined in: [packages/db/src/persisted-readiness.ts:14](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L14)

Anchor the deadline to this Collection's current sync run.

#### Returns

`number`

***

### getSnapshot()

```ts
getSnapshot: () => PersistedReadinessSnapshot;
```

Defined in: [packages/db/src/persisted-readiness.ts:15](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L15)

#### Returns

[`PersistedReadinessSnapshot`](../type-aliases/PersistedReadinessSnapshot.md)

***

### networkTimeoutMs

```ts
networkTimeoutMs: number;
```

Defined in: [packages/db/src/persisted-readiness.ts:12](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L12)

Time to prefer network before a completed persisted restore may render.

***

### subscribe()

```ts
subscribe: (listener) => () => void;
```

Defined in: [packages/db/src/persisted-readiness.ts:16](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L16)

#### Parameters

##### listener

() => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`

***

### waitForInitialRender()

```ts
waitForInitialRender: (__namedParameters) => object;
```

Defined in: [packages/db/src/persisted-readiness.ts:22](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L22)

The network-first initial-render wait, normally
`waitForPersistedInitialRender`. A persistence adapter supplies it with
its readiness, so an app with no persisted Collection does not ship it.

Resolve when network data is ready, or when the network deadline passes or
the network fails while every persisted source has restored. Reject with
the network error when no persisted fallback may render.

#### Parameters

##### \_\_namedParameters

[`PersistedInitialRenderInput`](PersistedInitialRenderInput.md)

#### Returns

`object`

##### cancel()

```ts
cancel: () => void;
```

###### Returns

`void`

##### promise

```ts
promise: Promise<void>;
```
