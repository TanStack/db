---
'@tanstack/db': patch
'@tanstack/electric-db-collection': patch
---

Fix isNull predicate causing LiveQuery to never become ready when offline. Reorder predicate checks in `isWhereSubsetInternal` so OR superset handling runs before AND subset decomposition, allowing `and(eq, isNull)` to match structurally equal disjuncts. Also separate `forceDisconnectAndRefresh` error handling into its own try-catch with correct error attribution.
