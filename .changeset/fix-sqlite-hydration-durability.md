---
'@tanstack/db-sqlite-persistence-core': patch
---

Fix stalled collection hydration when source transactions arrive during a SQLite hydration read. Ensure buffered transactions are durable before hydration completes.
