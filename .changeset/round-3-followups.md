---
'@tanstack/db': patch
---

Fix a ready callback error from a sync truncate committed inside the sync function. The error now surfaces when the sync function returns, as it does for `markReady()`, instead of stopping the sync function and moving the collection to `error`.
