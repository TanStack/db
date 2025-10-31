---
"@tanstack/query-db-collection": minor
---

**BREAKING**: Refactor query state utils from functions to getters

This change refactors the query state utility properties from function calls to getters, aligning with TanStack Query's API patterns and providing a more intuitive developer experience.

**Breaking Changes:**

- `collection.utils.lastError()` → `collection.utils.lastError`
- `collection.utils.isError()` → `collection.utils.isError`
- `collection.utils.errorCount()` → `collection.utils.errorCount`
- `collection.utils.isFetching()` → `collection.utils.isFetching`
- `collection.utils.isRefetching()` → `collection.utils.isRefetching`
- `collection.utils.isLoading()` → `collection.utils.isLoading`
- `collection.utils.dataUpdatedAt()` → `collection.utils.dataUpdatedAt`
- `collection.utils.fetchStatus()` → `collection.utils.fetchStatus`

**New Features:**
Exposes TanStack Query's QueryObserver state through new utility getters:

- `isFetching` - Whether the query is currently fetching (initial or background)
- `isRefetching` - Whether the query is refetching in the background
- `isLoading` - Whether the query is loading for the first time
- `dataUpdatedAt` - Timestamp of last successful data update
- `fetchStatus` - Current fetch status ('fetching' | 'paused' | 'idle')

This allows users to:

- Show loading indicators during background refetches
- Implement "Last updated X minutes ago" UI patterns
- Understand sync behavior beyond just error states

**Migration Guide:**
Remove parentheses from all utility property access. Properties are now accessed directly instead of being called as functions:

```typescript
// Before
if (collection.utils.isFetching()) {
  console.log("Syncing...", collection.utils.dataUpdatedAt())
}

// After
if (collection.utils.isFetching) {
  console.log("Syncing...", collection.utils.dataUpdatedAt)
}
```
