---
'@tanstack/query-db-collection': patch
---

Fix on-demand sync behavior so the full TanStack Query lifecycle is respected.

This patch resolves an issue where using on-demand synchronization could break the query lifecycle, including the error reported in https://github.com/TanStack/db/issues/998.