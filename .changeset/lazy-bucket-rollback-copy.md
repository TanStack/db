---
'@tanstack/db': patch
---

Copy an include bucket's rows for rollback only when a flush writes that bucket. Before, each flush of a live query with included child collections copied the rows of every child collection, so that it could restore them if the flush failed. A change to one child row in a list of 50 parents copied every row of all 50 child collections. A flush now copies the rows of only the child collections it writes. It still copies the small maps that track which child collections exist, so that part of the cost grows with the number of child collections. A failed flush still restores every written child collection to its rows, order and keys from before the flush.
