---
id: CreateLiveQueryObserverOptions
title: CreateLiveQueryObserverOptions
---

Defined in: [packages/db/src/live-query-observer.ts:1140](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L1140)

## Properties

### client?

```ts
optional client: DbClient;
```

Defined in: [packages/db/src/live-query-observer.ts:1157](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L1157)

DbClient cache that owns SSR snapshots for this query identity.

***

### mode?

```ts
optional mode: "granular" | "wholesale";
```

Defined in: [packages/db/src/live-query-observer.ts:1155](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L1155)

How subscribers consume the observer:

- `granular` (default): subscribers apply the delivered `ChangeMessage[]`
  deltas to their own keyed state (Vue/Svelte/Solid). The observer
  subscribes with initial state and seeds late subscribers, so every
  subscriber converges from deltas alone.
- `wholesale`: subscribers treat notifications as a wake-up and re-read
  `getSnapshot()` (React/Angular). The observer subscribes WITHOUT initial
  state, preserving those adapters' loading policy — no snapshot request,
  so no unfiltered `loadSubset` against on-demand collections. Nothing is
  delivered synchronously during `subscribe`, which keeps
  `useSyncExternalStore`-style consumers safe by construction.

***

### onPreload()?

```ts
optional onPreload: () => void;
```

Defined in: [packages/db/src/live-query-observer.ts:1161](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L1161)

Resume framework-deferred query sources before a server preload.

#### Returns

`void`

***

### queryHash?

```ts
optional queryHash: string;
```

Defined in: [packages/db/src/live-query-observer.ts:1159](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L1159)

Stable live-query identity used for dehydration and hydration.
