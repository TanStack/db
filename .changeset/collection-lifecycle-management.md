---
"@tanstack/db": minor
---

feat: implement Collection Lifecycle Management

Adds automatic lifecycle management for collections to optimize resource usage and align with application routing behavior.

**New Features:**

- **Lazy initialization**: Collections start syncing immediately but track subscribers for lifecycle management
- **Automatic garbage collection**: Collections are cleaned up after `gcTime` (default 5 minutes) of inactivity
- **Status tracking**: Collections have status: "loading" | "ready" | "error" | "cleaned-up"
- **Manual control**: Added `preload()` and `cleanup()` methods for explicit lifecycle management
- **Subscriber tracking**: Collections automatically track active subscribers and manage GC timers

**Breaking Changes:**

- Collections now start syncing immediately when created (previously lazy)
- Added new `gcTime` configuration option (defaults to 300000ms / 5 minutes)
- Added new `status` getter to expose collection lifecycle state

**Configuration:**

```typescript
const collection = createCollection({
  // ... existing config
  gcTime: 300000, // Optional: time in ms before cleanup (default: 5 minutes)
})

// New status tracking
console.log(collection.status) // "loading" | "ready" | "error" | "cleaned-up"

// Manual lifecycle control
await collection.preload() // Ensure collection is ready
await collection.cleanup() // Manually clean up resources
```

This implementation ensures collections are automatically managed based on usage patterns while providing manual control when needed.
