---
'@tanstack/db': patch
---

Fix `gcTime: Infinity` causing immediate garbage collection instead of disabling GC. JavaScript's `setTimeout` coerces `Infinity` to `0` via ToInt32, so we now explicitly check for non-finite values.
