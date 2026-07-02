---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
---

Significant performance improvements to live query hydration and incremental updates (1.5–2.8× faster on issue-tracker-shaped workloads):

- Includes subqueries (`toArray(subquery)` and other inline materializations) now use a lightweight in-memory child store instead of a full Collection instance per parent row, eliminating per-row collection construction and commit overhead.
- The `in` operator evaluator probes a precomputed `Set` for constant primitive arrays instead of scanning with deep equality per row; `eq` gets same-type primitive fast paths.
- Rows that already carry all virtual props are returned as-is on read instead of being defensively copied.
- `groupBy` no longer structurally hashes every row in its reduce index: pre-aggregated primitive values are consolidated by a cheap string discriminant (new `prefixIdentity` option on `Index`/`reduce` in `@tanstack/db-ivm`), and group keys use a fast serialization path.
- Sync commits take a fast path for plain inserts, and change events skip enrichment entirely when a collection has no subscribers.
