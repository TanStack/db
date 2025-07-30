---
"@tanstack/query-db-collection": patch
---

Add manual write methods to QueryCollectionUtils interface to enable direct state updates from external sources. Introduces writeInsert, writeUpdate, writeDelete, writeUpsert, and writeBatch methods that bypass the normal optimistic update flow for WebSocket/real-time scenarios. All methods include proper transaction handling, data validation, and automatic query cache synchronization.
