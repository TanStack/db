---
"@tanstack/db-ivm": patch
---

Add `groupedOrderByWithFractionalIndex` operator. This operator groups elements by a provided `groupKeyFn` and applies ordering and limits independently to each group. Each group maintains its own sorted collection with independent limit/offset, which is useful for hierarchical data projections where child collections need to enforce limits within each parent's slice of the stream rather than across the entire dataset.
