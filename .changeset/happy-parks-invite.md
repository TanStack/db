---
"@tanstack/query-db-collection": patch
---

Fix `staleTime` behavior by automatically subscribing/unsubscribing from TanStack Query based on collection subscriber count.

Previously, query collections kept a QueryObserver permanently subscribed, which broke TanStack Query's `staleTime` and window-focus refetch behavior. Now the QueryObserver properly goes inactive when the collection has no subscribers, restoring normal `staleTime`/`gcTime` semantics.
