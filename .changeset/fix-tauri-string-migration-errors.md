---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/tauri-db-sqlite-persistence': patch
---

Allow idempotent SQLite column migrations to recognize Tauri SQL duplicate-column errors returned as strings while continuing to reject unrelated migration failures.
