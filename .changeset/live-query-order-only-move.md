---
'@tanstack/db': patch
---

fix(db): republish ordered live queries on an order-only move

An `orderBy` live query that reordered its rows without changing any projected
row value (an "order-only move") previously emitted nothing, so `useLiveQuery`
kept rendering the stale order. The live-query collection now publishes an
explicit layout-change notification when this happens, and the shared live-query
observer snapshot exposes a `layoutRevision` that increments on any visible
membership, ordering, or order-only-move change. All five framework adapters
pick this up via their existing wholesale re-read.
