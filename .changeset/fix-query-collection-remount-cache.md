---
"@tanstack/query-db-collection": patch
"@tanstack/db": patch
---

Fix data loss on component remount by implementing reference counting for QueryObserver lifecycle

**What changed vs main:**

Previously, when live query subscriptions unsubscribed, there was no tracking of which rows were still needed by other active queries. This caused data loss during remounts.

This PR adds reference counting infrastructure to properly manage QueryObserver lifecycle:

1. Pass same predicates to `unloadSubset` that were passed to `loadSubset`
2. Use them to compute the queryKey (via `generateQueryKeyFromOptions`)
3. Use existing machinery (`queryToRows` map) to find rows that query loaded
4. Decrement the ref count
5. GC rows where count reaches 0 (no longer referenced by any active query)

**Impact:**

- Navigation back to previously loaded pages shows cached data immediately
- No unnecessary refetches during quick remounts (< gcTime)
- Multiple live queries with identical predicates correctly share QueryObservers
- Proper row-level cleanup when last subscriber leaves
- TanStack Query's cache lifecycle (gcTime) is fully respected
- No data leakage from in-flight requests when unsubscribing
