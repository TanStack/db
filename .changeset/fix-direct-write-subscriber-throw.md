---
'@tanstack/db': patch
---

A direct write (`insert`, `update` or `delete` outside a transaction) whose change subscriber throws no longer leaves a pending transaction behind. Before, the write's transaction stayed pending with its optimistic row visible, its handler never ran, and the Collection kept tracking it. The write now rolls back its own transaction, without rolling back other transactions, and rethrows the subscriber's error.
