---
"@tanstack/query-db-collection": patch
---

Add manual sync methods to QueryCollectionUtils interface to enable real-time collection updates. Introduces syncInsert, syncUpdate, syncDelete, syncUpsert, and syncBatch methods with proper transaction handling and query cache synchronization. All methods include data integrity validation and use named error classes for better error handling.
