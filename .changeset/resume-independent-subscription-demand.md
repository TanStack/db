---
'@tanstack/db': patch
---

Resume Collection sync when a new subscriber follows a suspended render, while preserving cleanup during startup.

Reject ordinary subscriptions and deferred acquisition resumption during active cleanup. Effects created during that interval still return disposed handles.

Release partial observer and pooled-query subscriptions when setup fails or cleanup interrupts startup. Resumed subscriptions release abandoned render deferrals without restoring retired ownership. Admission checks retain an existing cleanup promise until a replacement sync run starts.
