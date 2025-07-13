---
"@tanstack/db": patch
---

Enabled live queries to use the collection indexes

Live queries now use the collection indexes for many queries, using the optimized query pipeline to push where clauses to the collection, which is then able to use the index to filter the data.
