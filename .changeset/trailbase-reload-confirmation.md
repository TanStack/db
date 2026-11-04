---
'@tanstack/trailbase-db-collection': patch
---

Fix a write that never settled after `collection.reload()`. A write whose change event was still on the way when the reload replaced the change stream waited for an event that the new stream never delivers. The new stream now opens only after every earlier write is answered, and the reload's listing confirms those writes. A change event from another client for a record with a pending write still counts toward that write, because TrailBase events do not say which write made them.
