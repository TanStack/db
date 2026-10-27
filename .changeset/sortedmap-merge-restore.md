---
'@tanstack/db': minor
'@tanstack/db-ivm': patch
---

Breaking: `@tanstack/db` no longer exports `SortedMap`, and `SortedMap` no longer has `forEach`. `SortedMap` is the internal ordered map of Collection state.

- Ordered Collection views now keep rows with a runtime `undefined` or `null` key. Grouped Collections can produce these keys. Before, ordered reads could skip or lose these rows.
- When one publication applies 512 or more sync operations, the Collection now merges the changed keys into the existing order. Before, it sorted all rows again. With 50,000 rows, a `compare` option, and 600 operations in each sync transaction, the load takes 181 ms instead of 1,589 ms.
- Keyed `MultiSet.consolidate` groups entries in nested maps. It no longer encodes each value as a string.
