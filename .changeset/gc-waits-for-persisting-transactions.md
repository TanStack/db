---
'@tanstack/db': patch
---

Garbage collection no longer cleans up a collection while a transaction that touches it is persisting. Cleaning it up dropped the transaction's optimistic rows while its mutation handler still ran, and rejected waits such as Electric's `awaitTxId`, so a write could fail after the screen that made it unmounted. The `gcTime` delay now starts again when the last such transaction completes or fails, cancels obsolete queued idle cleanup, and preserves the remaining startup grace. Rolling back a manual transaction that stayed pending preserves the existing deadline. Explicit `cleanup()` still starts immediately; a transaction that settles afterward no longer restores another transaction's cleared optimistic rows.
