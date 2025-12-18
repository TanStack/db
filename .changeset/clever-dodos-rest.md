---
'@tanstack/db': patch
---

Fix subscriptions not re-requesting data after truncate in on-demand sync mode. When a must-refetch occurs, subscriptions now buffer changes and re-request their previously loaded subsets, preventing a flash of missing content. Also fixes delete events being incorrectly filtered out when `loadedInitialState` was true (which causes `sentKeys` to be empty) by skipping the delete filter during truncate buffering.
