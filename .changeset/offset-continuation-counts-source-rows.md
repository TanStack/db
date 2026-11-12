---
'@tanstack/db': patch
---

Fix ordered live queries over a sync adapter that honors only `offset`. A
continuation's offset counted at most the window's visible rows, so the
adapter served the same rows again and a filtered or joined window could stay
empty. The offset now counts every applied source row through the cursor,
including rows that an optimistic delete or update hides.
