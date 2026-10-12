---
'@tanstack/db': patch
---

A direct write (`insert`, `update` or `delete` outside a transaction) whose change subscriber throws no longer leaves a pending transaction behind. Before, the write's transaction stayed pending with its optimistic row visible, its handler never ran, and the Collection kept tracking it. The write now rolls back its own transaction, without rolling back other transactions, and rethrows the subscriber's error. A local-only direct write that takes the fast path (the Collection has no handler for that operation and no other pending or persisting transaction) stores its rows when it publishes them, so it completes its transaction and rethrows. On the transaction path it rolls back and rethrows, as any other direct write does.
