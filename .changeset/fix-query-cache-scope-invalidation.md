---
'@tanstack/query-db-collection': patch
---

Keep on-demand Query cache ownership and post-write readiness isolated across collections, co-owners, deferred cleanup, errors, and custom query hashes. Active enabled scopes revalidate from post-write provider results, while inactive collection-owned entries are removed without disturbing unrelated or foreign-observed Queries.
