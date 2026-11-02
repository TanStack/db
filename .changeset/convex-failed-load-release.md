---
'@tanstack/convex-db-collection': patch
---

Release the Convex query subscription when a Collection's first load fails, or when a later acceptance failure stops the sync run, instead of keeping it until cleanup.
