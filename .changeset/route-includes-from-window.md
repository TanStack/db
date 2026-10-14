---
'@tanstack/db': patch
---

Load includes only for the rows an ordered window shows. A live query with `orderBy` (a page with `limit` or `offset`, a `findOne`, or a window set with `setWindow`) no longer evaluates the includes in its own `select` (a child query, `toArray`, `materialize`, or `findOne`) for rows outside the window, so a late page costs about the same as the first one. With `distinct`, or with a parent `where` that names correlation values, the query no longer loads children for rows the window drops. Includes inherited from a subquery in `from`, and includes passed into `fn.select`, still load for every row before the window.

`setWindow` now moves only the query's own window. On a query whose parent has no `orderBy`, it throws `SetWindowRequiresOrderByError` even when an include child has its own `orderBy`, instead of moving the child windows.
