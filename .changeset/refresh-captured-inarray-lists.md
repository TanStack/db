---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
---

Read the current members of a caller-owned array captured by `inArray` when a compiled expression evaluates. After the array or one of its items changes, refresh the existing live-query result on the next source event, including rows untouched by that event. Let grouped queries retain their prior key and aggregate input values while they replace affected results.
