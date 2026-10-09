---
'@tanstack/db': patch
---

A live query with included child collections now throws when the query graph retires a child collection that still has rows the graph never removed. The graph always removes a child collection's rows before it retires it, so this is an internal invariant violation. Before, the rows were removed silently, which hid the fault. The failed flush restores the child collections, as for any failed flush.
