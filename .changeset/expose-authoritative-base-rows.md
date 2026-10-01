---
'@tanstack/db': patch
---

Expose `collection.base` for synchronous reads of applied authoritative rows without optimistic overlays. Reading the base does not start sync.
