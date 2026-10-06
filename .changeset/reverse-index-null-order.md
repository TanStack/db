---
'@tanstack/db': patch
---

Place null values first in a descending ordered query that uses an ascending index. Before, the query reversed the index and put rows with a null order value after every non-null row, while the documented order, and the same query without an index, put them first.
