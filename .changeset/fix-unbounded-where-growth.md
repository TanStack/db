---
'@tanstack/db': patch
---

Fix unbounded WHERE expression growth in `DeduplicatedLoadSubset` when loading all data after accumulating specific predicates. The deduplication layer now correctly tracks the original request predicate (e.g., `where: undefined` for "load all") instead of the optimized difference query sent to the backend, ensuring `hasLoadedAllData` is properly set and subsequent requests are deduplicated.
