---
'@tanstack/db': patch
---

Stop tracking a transaction after it fails or rolls back. Before, a Collection kept every failed or rolled-back transaction until the Collection was cleaned up. Each later mutation walked all of them, so a mutation got slower with each rollback the Collection had seen (about 20× after 4,000 rollbacks), and the failed transactions kept their rows in memory.
