---
"@tanstack/db": patch
---

If collection.update is called and nothing is changed, just return false instead of throwing
