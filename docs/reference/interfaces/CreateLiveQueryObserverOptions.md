---
id: CreateLiveQueryObserverOptions
title: CreateLiveQueryObserverOptions
---

Defined in: [packages/db/src/live-query-observer.ts:743](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L743)

## Properties

### client?

```ts
optional client: DbClient;
```

Defined in: [packages/db/src/live-query-observer.ts:760](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L760)

DbClient cache that owns SSR snapshots for this query identity.

***

### mode?

```ts
optional mode: "granular" | "wholesale";
```

Defined in: [packages/db/src/live-query-observer.ts:758](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L758)

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

Defined in: [packages/db/src/live-query-observer.ts:764](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L764)

Resume framework-deferred query sources before a server preload.

#### Returns

`void`

***

### queryHash?

```ts
optional queryHash: string;
```

Defined in: [packages/db/src/live-query-observer.ts:762](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L762)

Stable live-query identity used for dehydration and hydration.

***

### suspendUntilReady?

```ts
optional suspendUntilReady: boolean;
```

Defined in: [packages/db/src/live-query-observer.ts:766](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L766)

Read the completed stream rather than an earlier ordinary loading view.
