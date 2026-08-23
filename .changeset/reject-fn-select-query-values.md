---
'@tanstack/db': patch
---

Reject child query builders and query-construction helpers returned from `fn.select()` with type and runtime errors instead of exposing internal query objects.
