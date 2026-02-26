---
'@tanstack/offline-transactions': patch
---

Fix KeyScheduler to enforce strict FIFO ordering on retries. Previously, the scheduler could skip past a transaction waiting for retry and execute a later one, causing dependent UPDATE-before-INSERT failures. Also refactored `getNextBatch` to `getNext` to reflect that it always returns at most one transaction.
