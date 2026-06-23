---
'@tanstack/db': patch
---

Fix live query `preload()` hanging forever after a source collection was cleaned up (#1576)

When a source collection is cleaned up while a live query depends on it, the live query transitions to an error state and latches an internal `isInErrorState` flag. That flag was never reset, so restarting sync (e.g. calling `preload()` again after cleanup when switching profiles) left the live query unable to become ready and the returned promise never resolved. The flag is now cleared at the start of each sync session so the live query can recover.
