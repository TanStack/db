---
"@tanstack/db-ivm": patch
---

Fix bug where different numbers would hash to the same value. This caused distinct not to work properly.
