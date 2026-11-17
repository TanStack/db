---
'@tanstack/db-sqlite-persistence-core': patch
---

SQLite persistence now narrows number equality and membership on a top-level field in SQL. `eq(field, n)` and `inArray(field, [...])` with safe integers read only rows whose field holds that number or a Date at that epoch millisecond, and they can use the field's index. Other numbers, and nested refs such as `row.tags.length`, still read every row.

An ordered query with a `limit` now reads only its page from SQLite when SQLite provably keeps and orders the same rows as JavaScript. Its `where` must be absent or a conjunction of equality and membership tests on top-level fields with strings, BigInts or safe-integer numbers, or equality with a boolean, and each `orderBy` term must be a top-level field with a `createIndex` index whose stored values are all integers and booleans, or all lexically sorted text without characters at U+E000 or above. Every other ordered query reads its matching rows and pages them in JavaScript, as before. An index created by `createIndex` on a single top-level field now also keeps a small partial index of the rows that break this rule, which adds a little work to each write.

This also fixes a bug in earlier releases: a paged query now gets the rows a live query shows when its order field holds nulls or `NaN`. SQLite persistence placed nulls opposite to `nulls` for a descending order and tied `NaN` with every value, so a query such as `orderBy(({ r }) => r.n, { direction: 'desc', nulls: 'first' }).limit(3)` could return the wrong rows.
