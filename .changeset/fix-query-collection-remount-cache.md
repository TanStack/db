---
"@tanstack/query-db-collection": patch
---

Fix data loss on component remount for query collections

This fixes two related bugs that caused query collections to return empty data when components remount (e.g., during navigation):

1. Query observer subscriptions now process cached results immediately on subscription, ensuring data is synced when resubscribing to a query with cached data
2. Removed aggressive query cleanup that was overriding TanStack Query's gcTime setting, allowing proper cache persistence during quick remounts

Impact:
- Navigation back to previously loaded pages now shows cached data immediately
- No unnecessary refetches during quick remounts (< gcTime)
- TanStack Query's cache configuration (gcTime, staleTime) is now properly respected
- Fixes empty data flashes when navigating in SPAs
