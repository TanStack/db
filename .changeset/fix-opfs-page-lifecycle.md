---
'@tanstack/browser-db-sqlite-persistence': patch
---

Terminate OPFS workers on pagehide, including during initialization, and reject pending requests with AbortError. Include available VFS error details in SQLite open failures. Connections must be recreated when restoring a document from the back/forward cache.
