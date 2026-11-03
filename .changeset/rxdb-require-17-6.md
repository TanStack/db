---
'@tanstack/rxdb-db-collection': patch
---

Require RxDB 17.6.0 or later. In RxDB 17.1.0 to 17.5.0, a storage write that throws stops RxDB's incremental write queue (pubkey/rxdb#9025), so the adapter's update never settles and every later update on the collection waits forever. RxDB 17.6.0 fixes this, and the adapter's update now rejects with the storage error.
