---
'@tanstack/db-ivm': patch
---

Keep B-tree top-k results empty when the limit is zero, and advance the result window correctly when its first row is deleted.
