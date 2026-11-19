---
'@tanstack/rxdb-db-collection': patch
---

Fix initial sync failing with "Cannot insert document ... from sync because it already exists" when a document is inserted and then updated while the initial fetch is running. The buffered insert event is now applied over the row that the initial read already returned.
