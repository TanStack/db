---
"@tanstack/db": patch
---

Add `getOptimisticInfo()` method to track optimistic state per record. Returns metadata including `isOptimistic` flag, original/modified states, changes delta, and active mutations array for building UI features like loading badges and diff views.
