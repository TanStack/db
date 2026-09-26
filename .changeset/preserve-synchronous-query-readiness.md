---
'@tanstack/db': patch
'@tanstack/query-db-collection': patch
---

Preserve synchronous initial readiness for ordered and limited live queries when every required source acquisition applies synchronously. Avoid redundant ordered acquisition when sibling sources add synchronous graph input. Keep warm Query Collection results synchronous and return one aggregate fetch status from Query Collection utilities.
