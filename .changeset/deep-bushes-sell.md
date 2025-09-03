---
"@tanstack/db": patch
---

fix an bug where a live query that used joins could become stuck empty when its remounted/resubscribed
