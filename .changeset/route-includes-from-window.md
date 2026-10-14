---
'@tanstack/db': patch
---

Load includes only for the rows an ordered window shows. A live query with an `orderBy`, or a `findOne`, no longer evaluates the includes in its own `select` (a child query, `toArray`, `materialize`, or `findOne`) for rows outside its window, whether `limit` and `offset` set the window or `setWindow` moves it. A late page now costs about the same as the first one. With `distinct`, the query no longer loads children for every source row. A parent `where` that names correlation values still starts their child loads at once, unless a `limit`, an `offset`, or a `findOne` over several named rows can drop them. Includes inherited from a subquery in `from`, and includes passed into `fn.select`, still load for every row before the window.

`setWindow` now moves only the query's own window. A window inside a `from` subquery, a joined subquery, or an include child no longer answers it, so a query without its own `orderBy` throws `SetWindowRequiresOrderByError`.
