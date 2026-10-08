---
'@tanstack/db': patch
---

Stop tracking a transaction after it fails or rolls back. Before, a Collection kept every failed or rolled-back transaction, including a rolled-back offline restoration, until the Collection was cleaned up. Each later mutation walked all of them, so a mutation got slower with each rollback the Collection had seen (about 20× after 4,000 rollbacks), and the failed transactions kept their rows in memory. A settled transaction now leaves the Collection in the recompute that publishes its settlement, and removing it never removes a later transaction that reuses its id.

A settled transaction leaves every Collection that tracked it, including a Collection whose mutations merged away, a second Collection instance with the same id, and a Collection whose transaction rolled back during a sync commit.

When a subscriber throws during settlement, every Collection still recomputes and `isPersisted` still settles, including when the throw comes from a conflicting transaction that the rollback also rolls back. One error is rethrown as is; several are thrown together as an `AggregateError`. Before, a throw could leave other Collections showing the settled transaction's optimistic rows, and a throw from a conflicting rollback left the primary transaction's `isPersisted` pending.
