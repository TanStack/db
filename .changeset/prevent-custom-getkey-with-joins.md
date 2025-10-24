---
"@tanstack/db": patch
---

Fix: Prevent custom getKey with joined queries to avoid key conflicts

Added runtime validation that throws a clear error when attempting to use a custom `getKey` function with queries containing joins. This prevents a confusing bug where composite keys used internally by joins would conflict with custom keys, causing `CollectionOperationError` during sync.

Joined queries use composite keys like `"[key1,key2]"` internally to ensure uniqueness across multiple collections. Custom `getKey` functions that return simple keys create a mismatch that leads to duplicate key errors.

The new validation:

- Detects joins in queries and nested subqueries
- Throws `CustomGetKeyWithJoinError` at collection creation time
- Provides clear guidance on how to fix the issue

**Before:**

```typescript
// This would fail during sync with confusing errors
const mediaCollection = createLiveQueryCollection({
  query: (q) => q.from({ media: mediaBase })
    .join({ metadata: metadataCollection }, ...),
  getKey: (media) => media.id, // ❌ Causes key conflict
})
```

**After:**

```typescript
// Now throws immediately with clear error message
// Remove getKey to use default composite key behavior
const mediaCollection = createLiveQueryCollection({
  query: (q) => q.from({ media: mediaBase })
    .join({ metadata: metadataCollection }, ...),
  // ✅ No getKey - uses composite keys correctly
})

// To find items, use array methods instead of .get()
const item = mediaCollection.toArray.find(m => m.id === 'uuid')
```
