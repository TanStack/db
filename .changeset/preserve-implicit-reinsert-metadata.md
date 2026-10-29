---
'@tanstack/db-sqlite-persistence-core': patch
---

Preserve accepted row metadata when an equal source re-insert omits an explicit metadata write. Prevent peer reloads from restoring older cached metadata after that insert.
