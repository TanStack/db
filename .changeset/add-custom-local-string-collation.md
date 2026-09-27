---
'@tanstack/db': patch
---

Add custom local string comparators as collection defaults or individual order clauses. Queries that use a custom comparator load the filtered source before sorting and slicing locally.
