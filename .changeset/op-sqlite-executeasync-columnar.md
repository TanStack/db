---
"@tanstack/react-native-db-sqlite-persistence": patch
---

Handle op-sqlite v14 `executeAsync` columnar results (`rawRows` + `columnNames`) in the driver's result extraction. Previously the `rowsAffected` marker made every SELECT read as an empty write result, silently returning zero rows and crashing startup with `UNIQUE constraint failed: collection_registry.tombstone_table_name` (#1499).
