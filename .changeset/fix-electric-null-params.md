---
"@tanstack/electric-db-collection": patch
---

Fix invalid Electric proxy queries with missing params for null/undefined values

When comparison operators were used with null/undefined values, the SQL compiler would generate placeholders ($1, $2) in the WHERE clause but skip adding the params to the dictionary. This resulted in invalid queries being sent to Electric.

Now:

- `eq(col, null)` and `eq(col, undefined)` transform to `"col" IS NULL` syntax
- Other comparisons (gt, lt, gte, lte, like, ilike) with null/undefined throw a clear error since null comparisons don't make semantic sense in SQL
