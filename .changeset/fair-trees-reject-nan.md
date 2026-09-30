---
'@tanstack/db': patch
---

Reject invalid index comparator results instead of silently corrupting ordered indexes. A custom `compareFn` that returns `NaN` or a non-number (for example a boolean from `(a, b) => a > b`) now throws when an index operation calls it, on both `BTreeIndex` and `BasicIndex`. `NaN` keys remain supported with the default comparator.
