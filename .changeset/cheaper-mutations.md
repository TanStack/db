---
'@tanstack/db': patch
---

Make updates and query building cheaper. Updates to rows whose fields are all primitives track changes without a proxy, drafts of other rows allocate less, sorted Collections no longer re-sort when an existing row changes value, and query builder references allocate less. Mutation ids are now a random per-runtime prefix plus a counter instead of a random UUID per mutation; they stay unique across tabs and sessions, but are no longer bare UUIDs.
