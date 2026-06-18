---
'@tanstack/db': patch
---

Fix duplicate-key sync reconciliation for collection configs without live query internals so it reports the intended duplicate key error instead of throwing a TypeError.
