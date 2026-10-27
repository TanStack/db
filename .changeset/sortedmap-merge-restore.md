---
'@tanstack/db': minor
'@tanstack/db-ivm': patch
---

Breaking: Collection keys now always match the declared key type, a string or a number.

- A grouped live query that groups by one field now gives a `null`, `undefined`, boolean, or bigint group value a string key. Before, the key was the raw value, so `$key` was `null` for the `null` group. Read a group's key from its `$key`. String and number group values keep their keys.
- `sync.write` throws `UndefinedKeyError` or `InvalidKeyError` when `getKey` returns a key that is not a string or a number. Optimistic mutations already threw these errors. For a bigint key, the development message now shows the key instead of failing with a `TypeError`.
- `@tanstack/db` no longer exports `SortedMap`, and `SortedMap` no longer has `forEach`. `SortedMap` is the internal ordered map of Collection state.
- When one publication applies 512 or more sync operations, the Collection now merges the changed keys into the existing order. Before, it sorted all rows again. With 50,000 rows, a `compare` option, and 600 operations in each sync transaction, the load takes 181 ms instead of 1,589 ms.
- Keyed `MultiSet.consolidate` groups entries in nested maps. It no longer encodes each value as a string.
