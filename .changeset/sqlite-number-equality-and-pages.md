---
'@tanstack/db-sqlite-persistence-core': patch
---

SQLite persistence now narrows number equality and membership in SQL. `eq(field, n)` and `inArray(field, [...])` with safe integers read only rows whose field holds that number or a Date at that epoch millisecond, and they can use the field's index. Other numbers still read every row.

An ordered query with a `limit` now reads only its page from SQLite when SQLite provably keeps and orders the same rows as JavaScript. Its `where` must be absent or a conjunction of equality and membership tests on strings, BigInts or safe-integer numbers, or equality with a boolean, and each `orderBy` field needs a `createIndex` index whose stored values are all integers and booleans, or all lexically sorted text without characters at U+E000 or above. Every other ordered query reads its matching rows and pages them in JavaScript, as before. An index created by `createIndex` on a single field now also keeps a small partial index of the rows that break this rule, which adds a little work to each write.
