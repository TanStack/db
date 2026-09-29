---
'@tanstack/db': patch
---

Honor Collection string collation in auto-created indexes and ordered scan reads. Repeated ordered reads reuse a compatible index, and reads without an index use the same declared order.
