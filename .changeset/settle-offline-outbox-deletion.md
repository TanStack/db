---
'@tanstack/offline-transactions': patch
---

Wait for acknowledged outbox deletion before reporting a successful offline transaction. Preserve provider completion across deletion retries and restarts, and keep active callers from hanging after manual outbox removal.
