---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
'@tanstack/query-db-collection': patch
---

Fail-stop persisted collections when hydration or durability fails, and replay authoritative source transactions through one persistence-owned FIFO. Electric collections keep optimistic state immediate while surfacing durable failures through the collection error state instead of continuing from an incomplete baseline.

Query collections retain ownership metadata that the persisted wrapper already published instead of restoring stale ownership after the publication boundary.
