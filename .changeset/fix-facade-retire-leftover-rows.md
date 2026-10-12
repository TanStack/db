---
'@tanstack/db': patch
---

A live query with included child collections now throws when the query graph retires a child collection that still has rows the graph never removed. The graph always removes a child collection's rows before it retires it, so this is an internal invariant violation. Before, the rows were removed silently, which hid the fault. The failed flush restores the child collections, as for any failed flush.

Calling `cleanup()` on a child collection of a live query now returns a rejected promise. The live query owns its child collections, and several parent rows can share one. Before, a cleanup stopped the child collection for every parent that shared it, so they never saw its rows again. Clean up the live query instead. Ordinary Collections are not affected.

An optimistic update of a row in a child collection no longer throws "Bucket facade row has no public key". Each child row now carries its key in `$key`, so the copy that an update makes keeps it.

Also fix a lost child row behind a persisting transaction. When a user transaction on a child collection was persisting, an update to a child row that an earlier flush had written was applied as a delete, so the row disappeared when the transaction settled. A rollback in that state could also delete such a row. The adapter now decides each write from the child collection's synced rows, including writes that a persisting transaction holds, not from the rows the child collection shows.
