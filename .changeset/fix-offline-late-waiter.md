---
'@tanstack/offline-transactions': patch
---

`waitForTransactionCompletion(id)` no longer waits forever for a transaction that the executor already settled. Such a waiter now rejects with an error that says the transaction already settled. The executor remembers the last 1,000 transactions it settled. A waiter for an id that the executor does not know yet keeps waiting, because another tab can still queue that transaction.
