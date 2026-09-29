---
'@tanstack/offline-transactions': patch
---

Reject cyclic offline transaction values with a bounded error, preserve user objects that only imitate Temporal tags, and avoid allocating an index list for every serialized array.
