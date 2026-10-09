---
'@tanstack/offline-transactions': patch
---

A failed auto-commit of an offline transaction no longer causes an unhandled promise rejection. `mutate()` with `autoCommit` (the default) logged the failure and then rethrew it inside a `.catch`, so every failed auto-commit reached `unhandledRejection`. The failure is still logged, and `isPersisted` still rejects with the error.
