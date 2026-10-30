---
'@tanstack/db': patch
'@tanstack/react-db': patch
---

Accept `autoIndex` and `defaultIndexType` on live-query Collection and hook configs so downstream queries can index intermediate results. Preserve each React Suspense binding's indexing settings when queries share an output Collection.
