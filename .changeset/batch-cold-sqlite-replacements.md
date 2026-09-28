---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/cloudflare-durable-objects-db-sqlite-persistence': patch
---

Batch cold full-replacement SQLite writes to reduce worker round trips while preserving one atomic persisted transaction. Keep Cloudflare Durable Object batches within its 100-bound-parameter limit.
