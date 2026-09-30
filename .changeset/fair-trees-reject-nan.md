---
'@tanstack/db': patch
---

Reject invalid BTree comparator results instead of silently corrupting ordered indexes. Comparators that return NaN now throw when an operation encounters the invalid comparison; NaN keys remain supported with the default comparator.
