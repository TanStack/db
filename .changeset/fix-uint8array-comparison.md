---
"@tanstack/db": patch
"@tanstack/db-ivm": patch
---

Fix Uint8Array/Buffer comparison to work by content instead of reference. This enables proper equality checks for binary IDs like ULIDs in WHERE clauses using the `eq` function.
