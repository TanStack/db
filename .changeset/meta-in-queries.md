---
'@tanstack/query-db-collection': minor
'@tanstack/db': minor
---

Add support for meta field in queries to store query metadata

This release adds a new `meta` field to queries, allowing developers to attach arbitrary metadata to query definitions. The metadata is preserved throughout the query lifecycle and is accessible in live queries and subscription events.
