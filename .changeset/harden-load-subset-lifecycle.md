---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/query-db-collection': patch
---

Fix on-demand load settlement, ordered pagination, and replay to preserve coherent results across cancellation, failure, cleanup, and restart. Preserve subset results and ownership across Electric, PowerSync, Query, and SQLite persistence adapters. Correct live-query grouping, include projections, value identity, and indexed comparisons. D2 hashing now rejects structural cycles and excessive traversal depth or work with an explicit error; Collection handles retain object-reference identity without traversing their mutable contents.

Remove the unused public subset-algebra helpers: `isWhereSubset`, `unionWherePredicates`, `minusWherePredicates`, `isOrderBySubset`, `isLimitSubset`, `isOffsetLimitSubset`, `isPredicateSubset`, and `isLoadSubsetRequestSubsumedBy`. Apps that import these helpers must remove those imports; normal queries and adapters are unaffected. `DeduplicatedLoadSubset` remains available and shares only exact demand identities.

Reject compiled Collection-valued includes as `fn.select()` inputs, including nested descendants, before invoking the callback. Use `toArray()` or `materialize()` in the upstream `.select()` for child-value calculations. To keep live child Collections, use expression `.select()` or perform parent-only functional work before adding the includes. Ordinary Collection-valued includes remain supported.

Remove proxy `DEBUG` logging and automatic index timing statistics to avoid diagnostic work on reads and writes. Remove `getStats()` and `IndexStats`; use `index.keyCount` for the current entry count, and instrument index methods externally when profiling. Custom index subclasses must remove calls to the retired `trackLookup()` and `updateTimestamp()` helpers.

Remove unused internal helpers and the unused public error classes `WhereClauseConversionError`, `SubscriptionNotFoundError`, and `AggregateNotSupportedError`. These classes have no remaining runtime throw sites; remove any imports of them. Keep the existing query and index behavior and exercise identity/evaluation tests through the production entry points.
