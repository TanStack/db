---
'@tanstack/db': patch
'@tanstack/offline-transactions': patch
---

Stop tracking a transaction after it fails or rolls back. Before, a Collection kept every failed or rolled-back transaction, including a rolled-back offline restoration, until the Collection was cleaned up. Each later mutation walked all of them, so a mutation got slower with each rollback the Collection had seen (about 20× after 4,000 rollbacks), and the failed transactions kept their rows in memory. A settled transaction now leaves the Collection in the recompute that publishes its settlement, and removing it never removes a later transaction that reuses its id.

A settled transaction leaves every Collection that tracked it, including a Collection whose mutations merged away, a second Collection instance with the same id, and a Collection whose transaction rolled back during a sync commit.

When a subscriber throws during settlement, every Collection still recomputes and `isPersisted` still settles, including when the throw comes from a conflicting transaction that the rollback also rolls back. One error is rethrown as is; several are thrown together as an `AggregateError`. Before, a throw could leave other Collections showing the settled transaction's optimistic rows, and a throw from a conflicting rollback left the primary transaction's `isPersisted` pending.

A settled transaction no longer holds references to the Collections that tracked it, so a cleaned-up Collection can be garbage collected. Offline restoration now tracks and releases its transaction through the same path as other transactions.

When a mutation function rejects and a subscriber also throws during the rollback, `commit()` now rejects with one flat `AggregateError` whose first member and `cause` are the mutation error. Before, it rejected with the subscriber error and the mutation error was lost. Settlement errors from several conflicting rollbacks are reported as one flat `AggregateError` instead of nested ones.

Transaction ids must be unique among unsettled transactions. A write that would make a Collection track a second unsettled transaction with an id it already tracks now throws `DuplicateTransactionIdError` and changes nothing. Before, the second transaction silently replaced the first, whose optimistic rows disappeared while it was still pending. Settling a transaction also no longer removes a different pending transaction that shares its id from conflict tracking.
