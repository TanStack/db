---
"@tanstack/db": patch
---

fixed a bug where a pending sync transaction could be applied early when an optimistic mutation was resolved or rolled back
