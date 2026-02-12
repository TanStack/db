---
'@tanstack/db': patch
---

Fix `eq()` with Date objects in join conditions by normalizing join keys via `normalizeValue` (#934)
