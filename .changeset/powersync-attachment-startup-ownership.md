---
'@tanstack/powersync-db-collection': patch
---

Load attachment IDs before save/delete in eager and on-demand collections. Preserve existing files when a duplicate save is rejected, reject overlapping saves of the same ID across queues sharing a database, and clean up partial local writes.
