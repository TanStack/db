---
"@tanstack/db-ivm": patch
"@tanstack/db": patch
---

Add `groupByKey` and `groupKeyFn` options to `orderByWithFractionalIndex` and `topKWithFractionalIndex`. This is groundwork for hierarchical “includes” projections in TanStack DB, where child collections need to enforce limits within each parent’s slice of the stream rather than across the entire dataset. ([Issue #288](https://github.com/TanStack/db/issues/288))
