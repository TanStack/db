---
'@tanstack/db': patch
---

Preserve outer predicates pushed into joined and FROM subqueries during query compilation, including when the outer and inner aliases differ.
