---
'@tanstack/offline-transactions': patch
---

Ignore repeated leadership notifications when the state has not changed to avoid restarting active replay. Settle each transaction's commit when that transaction completes, without waiting for the shared queue to drain.

Keep a completed transaction registered until its outbox deletion settles so a leadership change during deletion does not schedule the same mutation again.
