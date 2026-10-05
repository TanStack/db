---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/cloudflare-durable-objects-db-sqlite-persistence': patch
---

Keep SQLite subset queries within driver binding limits for large `IN` filters and Cloudflare Durable Object transactions.
