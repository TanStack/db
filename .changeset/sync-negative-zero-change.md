---
'@tanstack/db': patch
---

Publish a change when a synced update changes a field only from `-0` to `0`, or the reverse. Before, the Collection stored the new value but emitted no change event, so subscribers and live queries kept the old one.
