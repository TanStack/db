---
'@tanstack/offline-transactions': patch
---

Fix KeyScheduler to enforce strict FIFO ordering on retries. Previously, `getNextBatch` could skip past a transaction waiting for retry and execute a later one, causing dependent UPDATE-before-INSERT failures.
