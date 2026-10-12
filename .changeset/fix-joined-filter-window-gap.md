---
'@tanstack/db': patch
---

An ordered, limited live query filtered through a LEFT join no longer shows a later row in place of an earlier one. The query loads a bounded prefix of root rows, and a row inserted after that prefix could enter the query's input. When a row left the result only through the join, for example because its joined row was deleted, the later row filled the window while an earlier eligible row was never loaded. A joined-side delete or update of a row the query has received now refreshes the root prefix, as a root delete does.
