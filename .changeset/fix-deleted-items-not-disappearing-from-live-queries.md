---
'@tanstack/db': patch
---

fix: deleted items not disappearing from live queries with `.limit()`

Fixed a bug where deleting an item from a live query with `.orderBy()` and `.limit()` would not remove it from the query results. The `subscribeChanges` callback would never fire with a delete event.

The issue was caused by duplicate inserts reaching the D2 pipeline, which corrupted the multiplicity tracking used by `TopKWithFractionalIndexOperator`. A delete would decrement multiplicity from 2 to 1 instead of 1 to 0, so the item remained visible.

Fixed by ensuring `sentKeys` is updated before callbacks execute (preventing race conditions) and filtering duplicate inserts in `filterAndFlipChanges`.
