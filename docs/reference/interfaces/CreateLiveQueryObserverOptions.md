---
id: CreateLiveQueryObserverOptions
title: CreateLiveQueryObserverOptions
---

# Interface: CreateLiveQueryObserverOptions

Defined in: [packages/db/src/live-query-observer.ts:845](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L845)

## Properties

### client?

```ts
optional client: DbClient;
```

Defined in: [packages/db/src/live-query-observer.ts:862](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L862)

DbClient cache that owns SSR snapshots for this query identity.

***

### mode?

```ts
optional mode: "granular" | "wholesale";
```

Defined in: [packages/db/src/live-query-observer.ts:860](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L860)

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

Defined in: [packages/db/src/live-query-observer.ts:866](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L866)

Resume framework-deferred query sources before a server preload.

#### Returns

`void`

***

### queryHash?

```ts
optional queryHash: string;
```

Defined in: [packages/db/src/live-query-observer.ts:864](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L864)

Stable live-query identity used for dehydration and hydration.
