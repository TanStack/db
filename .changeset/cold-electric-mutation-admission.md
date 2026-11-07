---
"@tanstack/db": patch
"@tanstack/db-sqlite-persistence-core": patch
"@tanstack/electric-db-collection": patch
---

Establish on-demand Electric stream positions before dispatching optimistic mutation handlers, including explicit multi-collection transactions. Revalidate positions after resets and prevent dispatch after cancellation or source retirement without preloading rows or retrying backend writes.
