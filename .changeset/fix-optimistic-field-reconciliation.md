---
'@tanstack/db': patch
---

Compose optimistic updates from their changed fields so concurrent updates and rollbacks preserve unrelated changes. Keep source updates beneath an optimistic live-query delete when queued sync batches apply, without changing sync queue timing.
