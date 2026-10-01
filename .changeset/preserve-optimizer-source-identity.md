---
'@tanstack/db': patch
---

Preserve source identity during query optimization so a joined subquery and sibling include can reuse an alias without hiding parent rows.
