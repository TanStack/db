---
'@tanstack/db': patch
---

Preserve restored rows for direct `subscribeChanges()` consumers after Collection cleanup and restart, even when their values are unchanged. This prevents incorrect delete events when the new sync run restores the same rows.
