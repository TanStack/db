---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/query-db-collection': patch
---

Fix on-demand load settlement, ordered pagination, and replay to preserve coherent results across cancellation, failure, cleanup, and restart. Preserve subset results and ownership across Electric, PowerSync, Query, and SQLite persistence adapters. Correct live-query grouping, include projections, value identity, and indexed comparisons, and bound D2 hashing for cyclic values.

Remove the unused public subset-algebra helpers: `isWhereSubset`, `unionWherePredicates`, `minusWherePredicates`, `isOrderBySubset`, `isLimitSubset`, `isOffsetLimitSubset`, `isPredicateSubset`, and `isLoadSubsetRequestSubsumedBy`. Apps that import these helpers must remove those imports; normal queries and adapters are unaffected. `DeduplicatedLoadSubset` remains available and shares only exact demand identities.
