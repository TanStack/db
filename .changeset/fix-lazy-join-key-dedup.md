---
'@tanstack/db': patch
---

Deduplicate and filter null join keys in lazy join subset queries. Previously, when multiple rows referenced the same foreign key or had null foreign keys, the full unfiltered array was passed to `inArray()`, producing bloated `ANY()` SQL params with repeated IDs and NULLs.
