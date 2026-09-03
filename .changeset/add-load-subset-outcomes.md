---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Settle `loadSubset` only after its sync writes are visible, and harden ordered loading, replay, cancellation, and adapter ownership without inferring broader source coverage.
