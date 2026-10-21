---
'@tanstack/browser-db-sqlite-persistence': patch
---

Reject pending OPFS requests when closing the SQLite connection, including when the worker reports a close error. Close now stops accepting requests when it starts, and concurrent `close()` calls share one outcome.
