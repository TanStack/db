---
"@tanstack/offline-transactions": minor
---

Add an opt-in `OfflineConfig.confirmWrite` hook that holds optimistic state across the post-commit confirmation window **off** the serial drain path.

Previously the only way to keep a row painted until an async sync stream (e.g. ElectricSQL's `awaitTxId`) echoed the write back was to `await` that confirmation inside the `mutationFn` — which serializes the whole outbox and collapses drain throughput. `confirmWrite` runs after the write commits and its outbox entry is removed, while the library keeps the just-committed mutations' optimistic overlay painted (reusing the same hold primitive as `restoreOptimisticState`) and releases it when the hook settles. The serial chain still serializes the POSTs (preserving create-then-update ordering); only the confirmation moved off it.

The hook is never expected to roll back — the write is already durably committed, so a rejection just drops the overlay early (a possible brief flicker), never data loss. A `maxConfirmationHolds` cap (default 1000) bounds concurrent holds to avoid O(n²) optimistic recompute on a large, fast drain, and `getActiveConfirmationHoldCount()` exposes the live count for diagnostics.

As part of this, the `mutationFn`'s return value is now threaded through to the completion promise and to `confirmWrite` (e.g. a server-assigned txid); previously it was awaited and discarded.
