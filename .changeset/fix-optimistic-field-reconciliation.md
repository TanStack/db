---
'@tanstack/db': patch
---

Preserve whole-row optimistic snapshots through sync and truncate. Fix insert-dependent update settlement, local origin tracking, and rollback publication while sibling requests remain pending. Keep source updates beneath an optimistic live-query delete when queued sync batches apply, without changing sync queue timing.
