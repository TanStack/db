---
'@tanstack/electric-db-collection': patch
---

Keep `awaitTxId` and `awaitMatch` waits across `collection.reload()`. Before, a reload rejected every pending wait with `StreamAbortedError`, so a write that the backend had accepted rolled back. The reloaded stream resumes the same shape log, so the waits now carry over and resolve when their txid or match arrives. Cleaning up the collection, or aborting its stream, still rejects them.
