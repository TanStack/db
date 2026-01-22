---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
---

Fix infinite loop in ORDER BY + LIMIT queries when WHERE clause filters out most data. Add `localIndexExhausted` flag to prevent repeated load attempts when the local index is exhausted. Also add safety iteration limits to D2 graph execution, maybeRunGraph, and requestLimitedSnapshot as backstops.
