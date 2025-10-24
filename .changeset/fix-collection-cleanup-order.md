---
"@tanstack/db": patch
---

Fix collection cleanup to fire status:change event with 'cleaned-up' status

Previously, when a collection was garbage collected, event handlers were removed before the status was changed to 'cleaned-up'. This prevented listeners from receiving the status:change event, breaking the collection factory pattern where collections listen for cleanup to remove themselves from a cache.

Now, the cleanup process:

1. Cleans up sync, state, changes, and indexes
2. Sets status to 'cleaned-up' (fires the event)
3. Finally cleans up event handlers

This enables the collection factory pattern:

```typescript
const cache = new Map<string, ReturnType<typeof createCollection>>()

const getTodoCollection = (id: string) => {
  if (!cache.has(id)) {
    const collection = createCollection(/* ... */)

    collection.on("status:change", ({ status }) => {
      if (status === "cleaned-up") {
        cache.delete(id) // This now works!
      }
    })

    cache.set(id, collection)
  }
  return cache.get(id)!
}
```
