---
'@tanstack/db': patch
---

Use a monotonic clock for Collection garbage collection when available, so wall-clock changes do not delay or advance scheduled cleanup.
