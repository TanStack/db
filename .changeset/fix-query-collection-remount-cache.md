---
"@tanstack/query-db-collection": patch
---

Fix data loss on component remount for query collections

This fixes two related bugs that caused query collections to return empty data when components remount (e.g., during navigation):

1. Query observer subscriptions now process cached results immediately on subscription, ensuring data is synced when resubscribing to a query with cached data
2. Changed query cleanup strategy to respect TanStack Query's cache lifecycle while properly removing unreferenced rows when live queries are garbage collected

Impact:

- Navigation back to previously loaded pages now shows cached data immediately
- No unnecessary refetches during quick remounts (< gcTime)
- TanStack Query's cache configuration (gcTime, staleTime) is now properly respected
- Proper garbage collection of unreferenced rows when live queries are cleaned up
- Fixes empty data flashes when navigating in SPAs
