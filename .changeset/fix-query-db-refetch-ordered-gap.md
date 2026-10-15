---
'@tanstack/query-db-collection': patch
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Show the right ordered window after an on-demand Query Collection refetches. When a refetch changes a page that has a later page after it, a row could sort between the two pages and be in neither result. Query DB now reports that through the new sync-adapter call `invalidateLoadedSubsets()`, and each ordered live query and Effect re-establishes its window with a bounded repair. This covers `utils.refetch()` and Query refetches such as `invalidateQueries`. An ordering repair that overlaps in-flight page or tie work now reads a bounded prefix instead of the full source. The SQLite persistence wrapper forwards the new call.
