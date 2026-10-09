---
'@tanstack/db': patch
---

Copy an include bucket's rows for rollback only when a flush writes that bucket. Before, each flush of a live query with included child collections copied the rows of every child collection, so that it could restore them if the flush failed. A change to one child row in a list of 50 parents copied every row of all 50 child collections. A flush now copies the rows of only the child collections it writes. It still copies the small maps that track which child collections exist, so that part of the cost grows with the number of child collections. For an include query without a limit, that copy is about 6% of a write at 100 parents and about 31% at 1,000 parents. A query with a limit copies none of these maps. A failed flush still restores every written child collection to its rows, order and keys from before the flush.

Fix a lost child update after a failed live-query commit. When the parent row commit of a live query with included child collections failed, the child collection changes from that flush were dropped, although the parent changes stayed pending. The next write then published the parent but left the child collection showing its old rows. The changes now stay pending, and the next flush publishes them once.

A failed flush also restores a child collection that a persisting transaction holds. Before, a row that the failed flush added appeared when the transaction settled, before any retry. One child collection's throwing subscriber no longer stops the other child collections from publishing, and a failed restore still lets each child collection publish later flushes.

A rollback now throws when graph output reached the child collections between a flush and its rollback, because restoring the flush would lose that output. This does not happen in a valid query. The rollback still restores the child collections and keeps them delivering events. A rollback after the live query is cleaned up does nothing.
