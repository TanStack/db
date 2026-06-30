---
'@tanstack/db': minor
---

Expose an `acknowledged` state for optimistic mutations, a virtual prop derived from existing internal state that sits between the optimistic write and the settled (synced-back) state.
Collections can use `tx.acknowledge()` from inside the mutation handler without exiting, so that people using the collection can decide to fire a transition or drop pending state upon `isAcknowledged` instead of waiting for `isSettled`.

Additive and non-breaking; `isPersisted` / `$synced` are unchanged; no conflict with pending/planned behaviors for `isSettled`.

- `Transaction.acknowledge()` — a setter called by a collection adapter when the server confirms a write.
- `Transaction.isAcknowledged` — resolves when `acknowledge()` is called, or with `isPersisted` when no adapter calls `acknowledge()`; rejects on failure. Never resolves later than `isPersisted`.
- `$acknowledged` virtual property — `true` once acknowledged, always `true` when `$synced` is `true`. Wired through row enrichment, the virtual-prop cache, and group-by aggregation, and emitted as a virtual-prop-only update when it flips mid-flight.
