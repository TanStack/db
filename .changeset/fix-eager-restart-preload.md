---
'@tanstack/db': patch
---

Fix eager live-query preloads after collection cleanup so they wait for the restarted source snapshot and resolve with its rows.
