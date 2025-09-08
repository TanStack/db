---
"@tanstack/db": patch
---

fix a bug that prevented chaining joins (joining collectionB to collectionA, then collectionC to collectionB) within one query without using a subquery
