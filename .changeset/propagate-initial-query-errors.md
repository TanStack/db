---
'@tanstack/db': patch
'@tanstack/query-db-collection': patch
---

Propagate initial query sync failures to collection status and readiness promises while preserving a ready cached snapshot on later refetch failures. Prevent rejected deduplicated subset requests from creating detached promise rejections.
