---
"@tanstack/db": patch
---

fix: support aggregates nested inside expressions (e.g. `coalesce(count(...), 0)`)
