---
"@tanstack/db-ivm": patch
"@tanstack/db": patch
---

Optimize order by to lazily load ordered data if a range index is available on the field that is being ordered on.
