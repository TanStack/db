---
'@tanstack/query-db-collection': patch
---

Prevent on-demand manual-sync writes from replacing predicate, order, or pagination cache entries with the full synced snapshot. Refetch active enabled entries and remove inactive or disabled entries, while eager collections still patch their full-result cache.
