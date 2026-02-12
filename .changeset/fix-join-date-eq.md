---
'@tanstack/db': patch
---

Fix `eq()` with Date objects in join conditions and `inArray()` with Date values in WHERE clauses by normalizing values via `normalizeValue` (#934)
