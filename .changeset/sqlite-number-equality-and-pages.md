---
'@tanstack/db-sqlite-persistence-core': patch
---

SQLite persistence now narrows number equality and membership in SQL. `eq(field, n)` and `inArray(field, [...])` with safe integers read only rows whose field holds that number or a Date at that epoch millisecond, and they can use the field's index. Other numbers still read every row.
