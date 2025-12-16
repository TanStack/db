---
'@tanstack/electric-db-collection': patch
---

Fix invalid Electric proxy queries with missing params for null/undefined values

When comparison operators were used with null/undefined values, the SQL compiler would generate placeholders ($1, $2) in the WHERE clause but skip adding the params to the dictionary. This resulted in invalid queries being sent to Electric.

Now all comparison operators (eq, gt, lt, gte, lte, like, ilike) throw a clear error when used with null/undefined values, since comparisons with NULL always evaluate to UNKNOWN in SQL. Users should use `isNull()` or `isUndefined()` to check for null values instead.
