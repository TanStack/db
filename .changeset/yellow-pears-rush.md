---
"@tanstack/query-db-collection": patch
---

query-collection now supports a `select` function to transform raw query results into an array of items. This is useful for APIs that return data with metadata or nested structures, ensuring metadata remains cached while collections work with the unwrapped array.
