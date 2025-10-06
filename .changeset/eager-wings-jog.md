---
"@tanstack/electric-db-collection": patch
---

The awaitTxId utility now resolves transaction IDs based on snapshot-end message metadata (xmin, xmax, xip_list) in addition to explicit txid arrays, enabling matching on the initial snapshot at the start of a new shape.
