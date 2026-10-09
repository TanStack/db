---
'@tanstack/offline-transactions': patch
---

A failed auto-commit of an offline transaction no longer causes an unhandled promise rejection. `mutate()` with `autoCommit` (the default) committed through its own copy of the auto-commit logic, which logged the failure and then rethrew it inside a `.catch`, so every failed auto-commit reached `unhandledRejection`. The offline transaction now passes `autoCommit` to its TanStack DB transaction, which reports the failure through `isPersisted` without an unhandled rejection. The extra `Auto-commit failed:` console error is gone.
