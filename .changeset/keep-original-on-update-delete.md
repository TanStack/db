---
'@tanstack/db': patch
---

A `delete` that follows an `update` of the same row in one transaction now keeps the row's first `original` (the state before the transaction) instead of the already-updated row.
