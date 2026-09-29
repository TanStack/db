---
'@tanstack/db': patch
---

Give each placement of a reused subquery builder an independent source identity so self-joins produce the correct rows.
