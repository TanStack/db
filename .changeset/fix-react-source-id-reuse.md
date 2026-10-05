---
'@tanstack/react-db': patch
---

Reject a different source Collection that reuses an ID within one mounted derived live query. Keep separate Suspense queries bound to their own source Collections when the sources share an ID.
