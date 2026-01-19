---
'@tanstack/offline-transactions': patch
---

Fix mutation.changes field being lost during offline transaction serialization. Previously, the changes field was not included in serialized mutations, causing it to be empty ({}) after app restart. This led to sync functions receiving incomplete data when using mutation.changes for partial updates.
