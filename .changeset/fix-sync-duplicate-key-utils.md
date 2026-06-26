---
'@tanstack/db': patch
---

Fix live query includes reconciliation so updates that re-emit existing child rows update internal child collections instead of attempting duplicate inserts, and ensure duplicate-key sync errors handle collection configs without live query internals.
