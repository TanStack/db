---
'@tanstack/offline-transactions': patch
---

Fix beforeRetry hook. When this hook filters out transactions during loadPendingTransactions(), those filtered transactions are removed from the outbox but remain in the scheduler. This causes them to be executed anyway, even though they were explicitly filtered out.
