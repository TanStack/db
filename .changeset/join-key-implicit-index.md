---
"@tanstack/db": patch
---

Joins on a collection's primary key no longer require an explicit index: query optimization now falls back to a synthetic key index derived from `getKey` (when it reads a single property), so lazy joins on the key load only the matching rows instead of falling back to a full collection scan.
