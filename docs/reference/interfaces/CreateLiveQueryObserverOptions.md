---
id: CreateLiveQueryObserverOptions
title: CreateLiveQueryObserverOptions
---

# Interface: CreateLiveQueryObserverOptions

Defined in: [packages/db/src/live-query-observer.ts:541](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L541)

## Properties

### mode?

```ts
optional mode: "granular" | "wholesale";
```

Defined in: [packages/db/src/live-query-observer.ts:556](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L556)

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
