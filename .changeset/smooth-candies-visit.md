---
"@tanstack/rxdb-db-collection": patch
---

Addressed the majority of "any" type usage in the rxdb-db-collection adapter as well as fixed querying for documents where \_deleted is false, which fixes issues when using localStorage or other persistent storage mechanisms.
