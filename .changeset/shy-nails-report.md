---
'@tanstack/powersync-db-collection': patch
---

Fixed bug where on-demand collections with the `id` column in their where clause would never be added to the PowerSync upload queue.
