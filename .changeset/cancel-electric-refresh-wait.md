---
'@tanstack/electric-db-collection': patch
---

Cancel an on-demand refresh wait when its request or collection is cleaned up, preventing snapshots from starting after teardown.
