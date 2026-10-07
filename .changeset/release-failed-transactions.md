---
'@tanstack/db': patch
---

Stop tracking a transaction after it fails or rolls back. Before, a Collection kept every failed or rolled-back transaction, including a rolled-back offline restoration, until the Collection was cleaned up. Each later mutation walked all of them, so a mutation got slower with each rollback the Collection had seen (about 20× after 4,000 rollbacks), and the failed transactions kept their rows in memory. A settled transaction now leaves the Collection in the recompute that publishes its settlement, and removing it never removes a later transaction that reuses its id.

When a transaction spans several Collections and one Collection's subscriber throws during settlement, the other Collections now still recompute before the error is rethrown. Before, they kept showing the settled transaction's optimistic rows.
