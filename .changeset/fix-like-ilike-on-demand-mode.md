---
"@tanstack/electric-db-collection": patch
---

Fixed bug where `like()` and `ilike()` operators were not working in on-demand mode. The SQL compiler was incorrectly treating these operators as function calls (`LIKE(column, pattern)`) instead of binary operators (`column LIKE pattern`). Now `like()` and `ilike()` correctly compile to SQL binary operator syntax, enabling search queries with pattern matching in on-demand mode. This fix supports patterns like `like(lower(offers.title), '%search%')` and combining multiple conditions with `or()`.
