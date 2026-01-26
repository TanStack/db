---
'@tanstack/db': patch
---

Fix `$selected` namespace availability in `orderBy` when using `fn.select`. Previously, the `$selected` namespace was only available when using regular `.select()`, not functional `fn.select()`.
