---
'@tanstack/powersync-db-collection': patch
---

Release the change watcher and any diff trigger when an eager Collection's first load fails, instead of keeping them until cleanup.
