---
'@tanstack/browser-db-sqlite-persistence': patch
---

Browser OPFS database opening previously waited without a deadline. It now rejects after 30 seconds by default and terminates the pending worker instead of acquiring the database later. Set `timeoutMs: 0` to keep the previous unbounded wait, override the deadline with another value, or pass an `AbortSignal` to cancel a pending open.
