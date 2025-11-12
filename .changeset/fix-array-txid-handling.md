---
"@tanstack/electric-db-collection": patch
---

Fix array txid handling in electric collection handlers. When returning `{ txid: [txid1, txid2] }` from an `onInsert`, `onUpdate`, or `onDelete` handler, the system would timeout with `TimeoutWaitingForTxIdError` instead of properly waiting for all txids. The bug was caused by passing array indices as timeout parameters when calling `awaitTxId` via `.map()`.
