---
"@tanstack/query-db-collection": minor
---

Automatically append predicates to static queryKey in on-demand mode.

When using a static `queryKey` with `syncMode: 'on-demand'`, the system now automatically appends serialized LoadSubsetOptions to create unique cache keys for different predicate combinations. This fixes an issue where all live queries with different predicates would share the same TanStack Query cache entry, causing data to be overwritten.

**Before:**
```typescript
// This would cause conflicts between different queries
queryCollectionOptions({
  queryKey: ['products'], // Static key
  syncMode: 'on-demand',
  queryFn: async (ctx) => {
    const { where, limit } = ctx.meta.loadSubsetOptions
    return fetch(`/api/products?...`).then(r => r.json())
  }
})
```

With different live queries filtering by `category='A'` and `category='B'`, both would share the same cache key `['products']`, causing the last query to overwrite the first.

**After:**
Static queryKeys now work correctly in on-demand mode! The system automatically creates unique cache keys:
- Query with `category='A'` → `['products', '{"where":{...A...}}']`
- Query with `category='B'` → `['products', '{"where":{...B...}}']`

**Key behaviors:**
- ✅ Static queryKeys now work correctly with on-demand mode (automatic serialization)
- ✅ Function-based queryKeys continue to work as before (no change)
- ✅ Eager mode with static queryKeys unchanged (no automatic serialization)
- ✅ Identical predicates correctly reuse the same cache entry

This makes the documentation example work correctly without requiring users to manually implement function-based queryKeys for predicate push-down.
