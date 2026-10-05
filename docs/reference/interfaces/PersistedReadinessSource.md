---
id: PersistedReadinessSource
title: PersistedReadinessSource
---

Defined in: [packages/db/src/persisted-readiness.ts:8](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L8)

**`Internal`**

Capability supplied by a persistence adapter, not by core sync.

## Properties

### getOrStartNetworkDeadline()

```ts
getOrStartNetworkDeadline: () => number;
```

Defined in: [packages/db/src/persisted-readiness.ts:12](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L12)

Anchor the deadline to this Collection's current sync run.

#### Returns

`number`

***

### getSnapshot()

```ts
getSnapshot: () => PersistedReadinessSnapshot;
```

Defined in: [packages/db/src/persisted-readiness.ts:13](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L13)

#### Returns

[`PersistedReadinessSnapshot`](../type-aliases/PersistedReadinessSnapshot.md)

***

### networkTimeoutMs

```ts
networkTimeoutMs: number;
```

Defined in: [packages/db/src/persisted-readiness.ts:10](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L10)

Time to prefer network before a completed persisted restore may render.

***

### subscribe()

```ts
subscribe: (listener) => () => void;
```

Defined in: [packages/db/src/persisted-readiness.ts:14](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L14)

#### Parameters

##### listener

() => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`
