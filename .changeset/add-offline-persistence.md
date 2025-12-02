---
"@tanstack/electric-db-collection": minor
---

feat: Add offline persistence adapter for Electric collections

This adds a localStorage-based persistence layer that enables offline-first data access and faster initial loads.

**What changed:**
- New `persistence` configuration option in `electricCollectionOptions`
- Collection data is automatically saved to localStorage as it syncs
- Persisted data is restored on collection initialization
- Shape handle and offset are persisted for resumable sync
- In `on-demand` mode, collections are marked ready immediately after loading from persistence

**Why:**
Enables offline-first applications where users can see their data immediately on app launch, even before network sync completes. This improves perceived performance and allows the app to function without network connectivity.

**How to use:**
```typescript
electricCollectionOptions({
  id: 'my-collection',
  syncMode: 'on-demand',
  persistence: {
    storageKey: 'my-collection-storage',
  },
  // ... other options
})
```
