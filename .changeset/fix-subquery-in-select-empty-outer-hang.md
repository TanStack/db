---
'@tanstack/db': patch
---

Fix `useLiveSuspenseQuery` (and any live query) hanging forever when a subquery-in-`select` source is an `on-demand` collection and the outer query returns zero rows. The lazy mechanism that loads inner-collection rows per outer row never fired its `loadSubset` (no parent rows → no per-row tap), so the on-demand inner stayed not-ready and `allCollectionsReady` never went true. Lazy aliases (subquery-in-select inner aliases and lazy-join inner aliases) are now skipped by the readiness gate; the existing `isLoadingSubset` gate still keeps the live query from marking ready while in-flight per-row loads are pending.
