---
'@tanstack/electric-db-collection': patch
---

Improve awaitTxId timeout error with debugging info showing which txids were received during the timeout period, plus a hint about the common cause (calling pg_current_xact_id outside the mutation transaction).
