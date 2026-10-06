---
'@tanstack/db': patch
---

Place null values first in a descending ordered query that uses an ascending index. Before, the query reversed the index and put rows with a null order value after every non-null row, while the documented order, and the same query without an index, put them first. A bounded read of a BTree index no longer sorts a group of equal values, including the null values, on each read: the index orders a group once and keeps it in order on writes, and a reversed read stops at the rows it needs.
