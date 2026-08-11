---
'@tanstack/powersync-db-collection': patch
---

Fixed `no such table` errors logged by the `on-demand` sync handler. Records are no longer flushed before the `diffTrigger` has been set up, and the tracking state is now cleared as part of disposal so unloading a subset or cleaning up the collection no longer flushes the dropped tracking table.
