---
'@tanstack/query-db-collection': patch
---

Fix updating all active query caches on directWrite for on-demand collections.Previously directWrite operations (e.g. writeUpdate/writeInsert) only updated the cache at the base query key for on-demand collections, leading to stale data when components remounted. This change ensures all active query cache keys are updated so data persists correctly.
