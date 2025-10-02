---
"@tanstack/db": patch
---

Fix live query stalls with concurrent optimistic inserts by clearing stale batching state and tolerating redundant sync echoes.
