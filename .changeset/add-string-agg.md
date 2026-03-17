---
'@tanstack/db-ivm': patch
'@tanstack/db': patch
---

Add `stringAgg` aggregate function for concatenating string values within groups. Supports configurable separators and ordering with efficient incremental maintenance via binary search and fast-path text splicing for head/tail changes.
