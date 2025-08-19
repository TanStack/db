---
"@tanstack/db": patch
---

Ensure that a new d2 graph is used for live queries that are cleaned up by the gc process. Fixes the "Graph already finalized" error.
