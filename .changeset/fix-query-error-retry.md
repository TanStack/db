---
'@tanstack/query-db-collection': patch
---

Keep the previous query error visible while `clearError()` retries. Clear the error after a successful retry, and count a failed retry as another consecutive failure.
