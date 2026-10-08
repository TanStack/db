---
'@tanstack/offline-transactions': minor
---

Add an optional `shouldRetry` callback for mutation errors. Return `undefined`
to use the default decision. `NonRetriableError` remains terminal, and retry
timing still uses the default backoff and configured jitter.
