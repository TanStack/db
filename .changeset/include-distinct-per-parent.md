---
'@tanstack/db': patch
---

Apply `distinct()` in an include child query within each parent's relation. Before, an include deduplicated child rows across all parents, so when two parents had an identical child row, only one of them kept it. Equal rows under one parent still collapse, and `distinct()` on a top-level query is unchanged.
