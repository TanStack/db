---
"@tanstack/query-db-collection": patch
---

Fix collection.preload() hanging when called without startSync or subscribers. The QueryObserver now subscribes immediately when sync starts (from preload(), startSync, or first subscriber), while maintaining the staleTime behavior by dynamically unsubscribing when subscriber count drops to zero.
