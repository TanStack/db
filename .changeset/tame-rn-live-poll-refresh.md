---
"@tanstack/electric-db-collection": patch
---

Bound the wait for Electric stream refreshes before loading on-demand subsets so native fetch implementations that do not promptly abort long polls do not keep live queries loading until the poll times out.
