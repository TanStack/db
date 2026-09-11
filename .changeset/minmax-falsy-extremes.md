---
'@tanstack/db-ivm': patch
---

Compare min and max aggregates against `undefined` instead of truthiness so `0`, `0n`, and `""` can be the extreme of a group.
