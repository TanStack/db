---
'@tanstack/db': patch
---

Load includes only for the rows an ordered window shows. A paginated live query with `orderBy`, `limit` or `offset`, and a `materialize` include no longer evaluates the include for rows before the page, so a late page costs about the same as the first one. With `distinct`, the query no longer evaluates the include for every source row.
