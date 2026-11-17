---
'@tanstack/db': patch
---

An explicit `cleanup()` now keeps the optimistic rows of a transaction that is still persisting cleared after the Collection restarts. Previously, a write made after the restart brought those rows back, so a row that cleanup had discarded reappeared. The transaction still holds its Collection until it settles.
