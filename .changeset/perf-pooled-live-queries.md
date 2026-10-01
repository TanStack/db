---
'@tanstack/db': patch
'@tanstack/react-db': patch
'@tanstack/vue-db': patch
'@tanstack/solid-db': patch
'@tanstack/svelte-db': patch
'@tanstack/angular-db': patch
---

Mount and update many small filtered live queries at Redux-level cost. A live query that reads one eager source Collection, filters it by at least one `eq(field, literal)`, and has no clause besides `where` is served from an equality partition shared by every query on those fields, in React, Vue, Solid, Svelte, and Angular. Its other `where` conditions on the row, such as `not`, `gt`, or `like`, are evaluated per query over its group. Queries with a `DbClient` (React, Svelte) or React Suspense keep a live-query Collection. Each query reads its group of rows instead of compiling a live query and subscribing to the source. With 240 such queries in React, mounting takes about 2.3 ms instead of 8.2 ms, and is the same with or without an index.

Results are unchanged: the same rows in key order with the same values and status, including a terminal error when the source is cleaned up. Two things can differ. Rows are the source Collection's row objects rather than copies. The returned `collection` is built only when your code reads it, so its automatic id may differ, and tools that list live Collections do not see a pooled query until then.
