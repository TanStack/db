---
'@tanstack/convex-db-collection': patch
---

Release the Convex query subscription when a Collection's first load fails, or when a later acceptance failure stops the sync run, instead of keeping it until cleanup. A new subscription no longer fails from an error the Convex client cached for its query before it subscribed, such as a restart right after a failed run; it waits for the server's result.
