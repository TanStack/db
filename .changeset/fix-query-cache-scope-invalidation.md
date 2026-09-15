---
'@tanstack/query-db-collection': patch
---

Prevent on-demand manual writes from replacing predicate-, order-, or pagination-scoped Query cache entries with the full synced collection snapshot. Active enabled scopes revalidate, while inactive or disabled entries are removed; eager collections continue to patch their full-result cache.
