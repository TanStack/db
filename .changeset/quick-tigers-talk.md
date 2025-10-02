---
"@tanstack/db": patch
---

Fix bug where optimized queries would use the wrong index because the index is on the right column but was built using different comparison options (e.g. different direction, string sort, or null ordering).
