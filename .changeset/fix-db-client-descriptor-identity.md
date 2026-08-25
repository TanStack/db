---
'@tanstack/db': patch
---

Reuse materialized collections when new collection descriptors have the same id. This lets callers recreate dynamic descriptors without creating duplicate collections.
