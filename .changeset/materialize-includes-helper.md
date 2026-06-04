---
'@tanstack/db': patch
---

Added the `materialize()` helper for includes subqueries. Multi-row subqueries produce an `Array<T>` snapshot on the parent row (equivalent to `toArray()`), and `findOne()` subqueries produce a single `T | undefined` value. The snapshot updates reactively as the underlying children change.
