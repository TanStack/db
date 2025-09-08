---
"@tanstack/db": patch
---

Fix bug where too much data would be loaded when the lazy collection of a join contains an offset and/or limit clause.
