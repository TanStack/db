---
'@tanstack/db': patch
---

Fix joined live queries that dropped or rejected a row when two source key pairs printed alike, such as (`a,b`, `c`) and (`a`, `b,c`), or `1` and `'1'`. Joined result keys are now JSON arrays of the two source keys, with `null` for a missing side: `["a","b"]`, `[4,1]`, `[4,null]`. Code that looks up joined rows by a hand-built key, such as `collection.get('[1,2]')`, must use the new format.
