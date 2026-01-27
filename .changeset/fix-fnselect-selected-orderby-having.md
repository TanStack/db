---
'@tanstack/db': patch
---

Fix `$selected` namespace availability in `orderBy`, `having`, and `fn.having` when using `fn.select`. Previously, the `$selected` namespace was only available when using regular `.select()`, not functional `fn.select()`.
