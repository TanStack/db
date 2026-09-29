---
'@tanstack/browser-db-sqlite-persistence': patch
---

Limit browser OPFS database opening to 30 seconds by default. Callers can override or disable the deadline and can cancel a pending open with an AbortSignal. A timed-out or aborted open terminates its worker instead of acquiring the database later.
