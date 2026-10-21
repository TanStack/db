---
'@tanstack/browser-db-sqlite-persistence': patch
---

Reject pending OPFS requests when closing the SQLite connection, including when the worker reports a close error.
