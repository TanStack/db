---
'@tanstack/offline-transactions': patch
---

`waitForTransactionCompletion` now settles for an offline transaction whose `mutate()` callback writes nothing. Such a transaction completes without running its mutation function, so before this change the executor never settled its waiter, and the promise stayed pending forever. It also settles for a transaction that is rolled back before it commits: the waiter rejects with an Error that names the rollback. A transaction rolled back while it persists still reports the executor's outcome. A callback that throws still leaves its transaction pending, as a core transaction does, so its waiter also stays pending until the transaction commits.

On a tab without offline leadership, `createOfflineTransaction` returns a plain transaction that the executor does not track, so `waitForTransactionCompletion` does not apply there.
