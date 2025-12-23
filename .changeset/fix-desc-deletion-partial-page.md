---
'@tanstack/db': patch
---

Fix useLiveInfiniteQuery not updating when deleting an item from a partial page with DESC order.

The bug occurred when using `useLiveInfiniteQuery` with `orderBy(..., 'desc')` and having fewer items than the `pageSize`. Deleting an item would not update the live result - the deleted item would remain visible until another change occurred.

The root cause was in `requestLimitedSnapshot` where `biggestObservedValue` was incorrectly set to the full row object instead of the indexed value (e.g., the salary field used for ordering). This caused the BTree comparison to fail, resulting in the same data being loaded multiple times with each item having a multiplicity > 1. When an item was deleted, its multiplicity would decrement but not reach 0, so it remained visible.
