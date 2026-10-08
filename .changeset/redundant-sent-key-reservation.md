---
'@tanstack/db': patch
---

Remove a duplicate step in `requestSnapshot` that recorded a subscription's snapshot keys before its callback ran. The callback wrapper already records them first, so behavior does not change.
