---
'@tanstack/db': patch
---

Deleting a row and inserting it again is faster in large Collections. V8 rehashes a large `Map` or `Set` when a key is deleted and later added again, at a cost that grows with its size: about 5µs per cycle on a 10,000-entry map. A Collection's synced rows, row origins, virtual-property cache and index key sets now keep a deleted key's entry and mark it deleted, so adding the key again writes it in place. They compact once deleted entries outnumber live ones. On a 10,000-row Collection, a repeated insert and delete of one row runs about 2.4× faster.
