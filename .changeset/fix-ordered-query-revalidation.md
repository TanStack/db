---
'@tanstack/db': patch
'@tanstack/query-db-collection': patch
---

Repair invalidated ordered queries with authoritative provider refetches and keep publication behind the repair. Revalidate active and cached Query Collection observers before applying repaired results.
