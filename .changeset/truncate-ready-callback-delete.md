---
'@tanstack/db': patch
---

Fix a truncate that sent a second delete for a row. When a ready callback deleted a replaced row while a sync truncate became ready, a subscriber without initial state got a delete for a row it no longer held.
