---
'@tanstack/rxdb-db-collection': patch
---

Insert a transaction's documents one at a time, in mutation order, and stop at the first rejected insert, as updates and deletes already do. Before, RxDB wrote the documents after a rejected one anyway, so a rejected transaction could leave later rows saved. It could also write the documents out of order.
