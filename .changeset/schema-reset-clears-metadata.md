---
"@tanstack/db-sqlite-persistence-core": patch
---

Clear `collection_metadata` in the same transaction as a schema-mismatch reset. Previously the reset wiped rows, tombstones, and the replay log but left collection metadata behind — including Electric's `electric:resume` offset/handle — so the next sync resumed past all of the wiped data and the collection came up permanently empty (#1589).
