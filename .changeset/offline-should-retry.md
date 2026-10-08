---
'@tanstack/offline-transactions': minor
---

Add `OfflineConfig.shouldRetry` so apps can keep recoverable mutation errors,
such as a 401, in the outbox for retry. Return `undefined` to use the default
decision. `NonRetriableError` remains terminal, and retry timing stays the same.
