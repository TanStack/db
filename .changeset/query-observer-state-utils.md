---
"@tanstack/query-db-collection": minor
"@tanstack/db": patch
---

Add QueryObserver state utilities and convert error utils to getters

Exposes TanStack Query's QueryObserver state through QueryCollectionUtils, providing visibility into sync status beyond just error states. Also converts existing error state utilities from methods to getters for consistency with TanStack DB/Query patterns.

**Breaking Changes:**

- `lastError()`, `isError()`, and `errorCount()` are now getters instead of methods
  - Before: `collection.utils.lastError()`
  - After: `collection.utils.lastError`

**New Utilities:**

- `isFetching` - Check if query is currently fetching (initial or background)
- `isRefetching` - Check if query is refetching in background
- `isLoading` - Check if query is loading for first time
- `dataUpdatedAt` - Get timestamp of last successful data update
- `fetchStatus` - Get current fetch status ('fetching' | 'paused' | 'idle')

**Use Cases:**

- Show loading indicators during background refetches
- Implement "Last updated X minutes ago" UI patterns
- Better understanding of query sync behavior

**Example Usage:**

```ts
const collection = queryCollectionOptions({
  // ... config
})

// Check sync status
if (collection.utils.isFetching) {
  console.log("Syncing with server...")
}

if (collection.utils.isRefetching) {
  console.log("Background refresh in progress")
}

// Show last update time
const lastUpdate = new Date(collection.utils.dataUpdatedAt)
console.log(`Last synced: ${lastUpdate.toLocaleTimeString()}`)

// Check error state (now using getters)
if (collection.utils.isError) {
  console.error("Sync failed:", collection.utils.lastError)
  console.log(`Failed ${collection.utils.errorCount} times`)
}
```
