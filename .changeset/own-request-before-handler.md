---
'@tanstack/db': patch
---

Fix a confirmed direct mutation that stayed pending. When an `onInsert`, `onUpdate`, or `onDelete` handler confirmed its request through sync before it returned, the row kept its optimistic value and `$hasPendingWrites: true` after the transaction completed, and the next remote change to the row reported `$origin: 'local'`. The Collection now owns the request before its handler runs, so that confirmation waits for the transaction and then settles the row.
