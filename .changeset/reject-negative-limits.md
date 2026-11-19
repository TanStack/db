---
'@tanstack/db': patch
---

Reject negative `.limit()` values and negative limits passed to `setWindow()` before they can change a query or its active window. Keep zero limits and negative offsets working.
