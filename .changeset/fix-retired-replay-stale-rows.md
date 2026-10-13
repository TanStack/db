---
'@tanstack/db': patch
---

A subscriber no longer keeps stale rows after a truncate replay that loses its last demand. When the last requested subset is released while the replay is still loading, nothing can complete the replay. If its current attempt has not failed, the subscriber now receives the rows the source wrote, replaced or deleted during it, instead of keeping the values from before the truncate. A replay whose attempt failed still keeps the last complete snapshot, as before, and a later request updates any row it still shows at an older value.
