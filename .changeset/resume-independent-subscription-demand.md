---
'@tanstack/db': patch
---

Resume Collection sync when a new subscriber follows a suspended render, while preserving cleanup during startup.

Reject ordinary subscriptions and deferred acquisition resumption during active cleanup. Effects created during that interval still return disposed handles.
