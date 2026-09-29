---
'@tanstack/db': patch
---

Keep pagination continuation accurate when a page succeeds after an overlapping window failure or source rows change under the retained error, including direct snapshot reads. Keep the earlier error visible until recovery begins.
