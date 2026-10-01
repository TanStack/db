---
'@tanstack/db': patch
'@tanstack/react-db': patch
---

Mount and update many small filtered live queries at Redux-level cost. In React, a `useLiveQuery` that reads one eager source Collection and filters it only by `eq(field, literal)` conjuncts, without a `DbClient` or Suspense, is served from an equality partition shared by every query on those fields. Each component reads its group of rows instead of compiling a live query and subscribing to the source. With 240 such queries, mounting takes about 2.3 ms instead of 8.2 ms, and is the same with or without an index.

Results are unchanged: the same rows in key order with the same values and status, including a terminal error when the source is cleaned up. Two things can differ. Rows are the source Collection's row objects rather than copies. The returned `collection` is built only when your code reads it, so its automatic id may differ, and tools that list live Collections do not see a pooled query until then.
