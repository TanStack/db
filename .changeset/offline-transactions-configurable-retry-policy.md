---
'@tanstack/offline-transactions': minor
---

Allow applications to set `OfflineConfig.retryPolicy` to choose retry classification and backoff for mutation function failures. The existing default remains unchanged when the option is omitted. A custom policy must return a finite delay; invalid policy results fail before a retry record is published.
