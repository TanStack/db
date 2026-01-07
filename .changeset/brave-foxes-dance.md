---
'@tanstack/offline-transactions': patch
---

Fix race condition that caused double replay of offline transactions on page load. The issue occurred when WebLocksLeader's async lock acquisition triggered the leadership callback after requestLeadership() had already returned, causing loadAndReplayTransactions() to be called twice.
