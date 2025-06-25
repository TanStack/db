---
"@tanstack/db": patch
---

feat: implement Collection Lifecycle Management

Adds automatic lifecycle management for collections to optimize resource usage.

**New Features:**

- Added `startSync` option (defaults to `true`, set to `false` for lazy loading)
- Automatic garbage collection after `gcTime` (default 5 minutes) of inactivity
- Collection status tracking: "idle" | "loading" | "ready" | "error" | "cleaned-up"
- Manual `preload()` and `cleanup()` methods for lifecycle control

**Usage:**

```typescript
const collection = createCollection({
  startSync: false, // Enable lazy loading
  gcTime: 300000, // Cleanup timeout (default: 5 minutes)
})

console.log(collection.status) // Current state
await collection.preload() // Ensure ready
await collection.cleanup() // Manual cleanup
```
