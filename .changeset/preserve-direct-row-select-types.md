---
'@tanstack/db': patch
---

Fix direct whole-row selections so their inferred type keeps virtual fields and optional properties, matching the runtime result.
