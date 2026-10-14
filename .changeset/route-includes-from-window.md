---
'@tanstack/db': patch
---

Load includes only for the rows an ordered window shows. A live query with an `orderBy`, or a `findOne`, no longer evaluates the includes in its own `select` (a child query, `toArray`, `materialize`, or `findOne`) for rows outside its window, whether `limit` and `offset` set the window or `setWindow` moves it. A late page now costs about the same as the first one. With `distinct`, the query no longer loads children for every source row. A `where` that names correlation values starts their child loads at once only when no enclosing query has a window, no window requested before start has a nonzero offset, and either the query has no window or it is a `findOne` that shows one row, with no `offset`, for one named correlation value. Any other window, including one that `setWindow` requests later, can drop those rows. Includes inherited from a subquery in `from`, and includes passed into `fn.select`, still load for every row before the window.

`setWindow` now moves only the query's own window. A window inside a `from` subquery, a joined subquery, or an include child no longer answers it, so a query without its own `orderBy` or `findOne` throws `SetWindowRequiresOrderByError`.

**Breaking:** a `findOne` window keeps its compiled limit, 1 (or 0 for `.limit(0).findOne()`). `getWindow()` returns `{ offset, limit }` with that limit, also for a `findOne` without `orderBy`. `setWindow` can move a `findOne`'s offset, but now throws for any other limit; before, `setWindow({ limit: 3 })` made a `findOne` show three rows.
