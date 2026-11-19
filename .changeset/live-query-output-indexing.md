---
'@tanstack/db': patch
'@tanstack/react-db': patch
---

Accept `autoIndex` and `defaultIndexType` on live-query Collection and hook configs so downstream queries can index intermediate results. Keep independent React Suspense bindings' Collection options separate when they differ. Validate eager indexing declarations on every DbClient preload, including cached reuse.
