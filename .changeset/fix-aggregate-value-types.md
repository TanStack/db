---
'@tanstack/db': patch
---

Restrict built-in aggregate helpers to their supported value domains so numeric aggregates and min/max no longer advertise impossible runtime result types.
