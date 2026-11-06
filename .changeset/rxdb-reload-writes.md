---
'@tanstack/rxdb-db-collection': patch
---

Fix writes made around a `collection.reload()`. A write now returns only once its change is in the collection's synced rows. Before, after a reload, a write could return while its change was still buffered, so its row briefly disappeared, or the write never settled. A reload's initial read now replaces the kept rows at once.
