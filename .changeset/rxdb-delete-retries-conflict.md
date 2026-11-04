---
'@tanstack/rxdb-db-collection': patch
---

Retry a delete when another client changes the document while the delete waits. Before, a delete that met a newer revision, for example from another tab or a replication pull, failed with a conflict and its row came back. The adapter now removes each document with `incrementalRemove`, which retries over the newer revision, as updates already did.
