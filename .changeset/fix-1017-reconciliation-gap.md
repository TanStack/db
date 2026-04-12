---
"@tanstack/db": patch
---

fix: item disappears during optimistic-to-synced transition (#1017)

`collection.insert()` calls `commit()` (which synchronously enters `mutationFn`/`onInsert`)
before `recomputeOptimisticState(true)` sets up the optimistic entry. This means `collection.has(key)`
returns `false` inside `onInsert`, and any sync data delivered during `onInsert` (e.g., Electric's
txid handshake) cannot find the item.

Fix: move `transactions.set()`, `scheduleTransactionCleanup()`, and `recomputeOptimisticState(true)`
before `commit()` so the item is in `optimisticUpserts` when `onInsert` runs.
