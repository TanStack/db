---
'@tanstack/db-sqlite-persistence-core': patch
---

Add schema-aware overloads to `persistedCollectionOptions` so schema-based calls infer the correct types and remain compatible with `createCollection`.
