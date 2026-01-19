---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
---

Add string support to `min()` and `max()` aggregate functions. These functions now work with strings using lexicographic comparison, matching standard SQL behavior.
