---
"@tanstack/query-db-collection": minor
---

Improve writeBatch API to use callback pattern

- Changed `writeBatch` from accepting an array of operations to accepting a callback function
- Write operations called within the callback are automatically batched together
- This provides a more intuitive API similar to database transactions
- Added comprehensive documentation for Query Collections including direct writes feature
