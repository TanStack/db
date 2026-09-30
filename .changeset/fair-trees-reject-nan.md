---
'@tanstack/db': patch
---

Reject invalid index comparator results instead of silently corrupting ordered indexes. A custom `compareFn`, or a custom collation `compare` in `compareOptions`, that returns `NaN` or a non-number (for example a boolean from `(a, b) => a > b`) now throws when an index operation calls it, on both `BTreeIndex` and `BasicIndex`. When this happens while a collection updates its indexes, the collection moves to the `error` state and later mutations throw `CollectionInErrorStateError`; previously the rows were kept with a misordered index. `NaN` keys remain supported with the default comparator.
