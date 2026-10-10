---
'@tanstack/db': patch
---

A live query with included child collections now throws when the query graph retires a child collection that still has rows the graph never removed. The graph always removes a child collection's rows before it retires it, so this is an internal invariant violation. Before, the rows were removed silently, which hid the fault. The failed flush restores the child collections, as for any failed flush.

Also fix a lost child row behind a persisting transaction. When a user transaction on a child collection was persisting, an update to a child row that an earlier flush had written was applied as a delete, so the row disappeared when the transaction settled. A rollback in that state could also delete such a row. The adapter now decides each write from the child collection's synced rows, including writes that a persisting transaction holds, not from the rows the child collection shows.
