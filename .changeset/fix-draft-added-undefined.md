---
'@tanstack/db': patch
---

Fix an update that drops a field added as `undefined`. When a callback added a field with the value `undefined` and set another field back to its original value, the draft treated every change as reverted and reported nothing.
