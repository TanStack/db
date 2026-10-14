---
'@tanstack/db': patch
---

Load includes only for the rows an ordered window shows. A paginated live query with `orderBy` and `limit` or `offset` no longer evaluates the includes in its own `select` (a child query, `toArray`, `materialize`, or `findOne`) for rows before the page, so a late page costs about the same as the first one. With `distinct`, the query no longer evaluates those includes for every source row. Includes inherited from a subquery in `from`, and includes passed into `fn.select`, still load for every row before the window.
