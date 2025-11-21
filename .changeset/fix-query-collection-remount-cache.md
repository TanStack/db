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

**Root Cause Analysis:**

The CI mutation test failures revealed edge cases in refcount tracking:

1. `requestLimitedSnapshot` can be called multiple times from `loadMoreIfNeeded` as queries load data incrementally
2. Each call makes multiple `loadSubset` calls and tracked them in `loadedSubsets` array
3. Race conditions in CI (slower execution) caused duplicate tracking of the same subset
4. On unsubscribe, duplicate `unloadSubset` calls decremented refcount below actual observer usage
5. Premature cleanup attempted while TanStack Query still had active listeners

**Additional Fixes:**

1. **Safety check**: Added `observer.hasListeners()` check before cleanup to prevent premature destruction even if refcount suggests cleanup
2. **Deduplication**: Changed `loadedSubsets` from Array to Map to automatically deduplicate identical subset requests
3. These work together: deduplication reduces unnecessary unload calls, safety check prevents cleanup when observer is still active

**Impact:**

- Navigation back to previously loaded pages shows cached data immediately
- No unnecessary refetches during quick remounts (< gcTime)
- Multiple live queries with identical predicates correctly share QueryObservers
- Proper row-level cleanup when last subscriber leaves
- TanStack Query's cache lifecycle (gcTime) is fully respected
- No data leakage from in-flight requests when unsubscribing
- Robust handling of race conditions in async environments (CI, slow devices)
