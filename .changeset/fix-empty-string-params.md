---
'@tanstack/electric-db-collection': patch
---

Fix empty string values being incorrectly omitted from SQL query params. Queries like `eq(column, '')` now correctly include the empty string parameter instead of producing a malformed query with a missing `$1` value.
