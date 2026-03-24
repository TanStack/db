---
'@tanstack/db': patch
---

Fix BTree index receiving the wrong comparator when a query uses multiple `orderBy` columns. The multi-column array comparator was passed to `ensureIndexForField` to create a single-column index, causing the BTree to treat all indexed values as equal. This collapsed the index to a single entry, making `takeFromStart()` return at most 1 key and breaking live query subscriptions that relied on the index for pagination (e.g. `useLiveInfiniteQuery` with `.orderBy(col1).orderBy(col2).limit(n)`). The fix passes a proper single-column comparator built from the first `orderBy` column's compare options.
