---
'@tanstack/powersync-db-collection': patch
---

Fix an on-demand collection loading no rows when two or more of its subsets have no `where`, for example a row count and a paginated list over the same table. The subsets were merged as `or(undefined, ...)`, which compiled to `NULL OR ...` in the diff triggers and the initial query.
