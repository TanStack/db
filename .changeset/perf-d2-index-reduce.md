---
'@tanstack/db-ivm': patch
---

`reduce`, `groupBy`, and the joins they feed do less work per changed key: a reduce whose key has at most one output before and after compares the two directly instead of building two maps, its state no longer keeps a per-key presence count that only joins read, and index reads build their result directly. Live queries with includes hydrate slightly faster.
