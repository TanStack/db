---
'@tanstack/solid-db': patch
---

Fix reconcile usage in useLiveQuery by setting the key field to "$key" so that items are matched correctly during reconcilation. Fixes #1524.

