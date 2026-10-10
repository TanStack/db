---
'@tanstack/db': patch
---

A direct write (`insert`, `update` or `delete` outside a transaction) whose change subscriber throws no longer leaves a pending transaction behind. Before, the write's transaction stayed pending with its optimistic row visible, its handler never ran, and the Collection kept tracking it. The write now rolls back its own transaction, without rolling back other transactions, and rethrows the subscriber's error. A local-only direct write, which stores its rows when it publishes them, completes its transaction and rethrows. A direct write made inside another Collection's change subscriber, including a local-only one, now fails on its own subscriber's error. Before, the error failed the outer write instead.
