---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
---

An ordered, limited live query or Effect filtered through a LEFT join no longer shows a later row in place of an earlier one. The query loads a bounded prefix of root rows, and a row inserted after that prefix could enter the query's input. When a row left the window without a root delete, for example because its joined row was deleted or inserted, or its join key changed, the later row filled the window while an earlier eligible row was never loaded. A window row after the loaded prefix no longer counts toward a full window, so the query loads the next page first.
