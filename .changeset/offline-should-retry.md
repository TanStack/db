---
'@tanstack/offline-transactions': minor
---

Add `OfflineConfig.shouldRetry` so an app can retry an offline transaction after
its named mutation function rejects with a recoverable error, such as a 401.
Return `undefined` to use the default decision. `NonRetriableError` remains
terminal, and retry timing stays the same. The hook returns synchronously and
applies to all named mutation functions.
If the hook fails, the executor removes only that outbox row and rejects its
waiters; queued transactions continue after terminal cleanup.
