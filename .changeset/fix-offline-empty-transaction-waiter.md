---
'@tanstack/offline-transactions': patch
---

`waitForTransactionCompletion` now settles for an offline transaction whose `mutate()` callback writes nothing. Such a transaction completes without running its mutation function, so before this change the executor never settled its waiter, and the promise stayed pending forever. A callback that throws still leaves its transaction pending, as a core transaction does, so its waiter also stays pending until the transaction commits.
