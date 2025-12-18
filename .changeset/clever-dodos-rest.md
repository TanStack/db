---
'@tanstack/db': patch
---

Fix subscriptions not re-requesting data after truncate in on-demand sync mode. When a must-refetch occurs, subscriptions now buffer changes and re-request their previously loaded subsets, preventing a flash of missing content.
