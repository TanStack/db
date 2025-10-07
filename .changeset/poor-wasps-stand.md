---
"@tanstack/electric-db-collection": minor
---

feat: Add awaitMatch utility for electric-db-collection (#402)

Adds a new `awaitMatch` utility function to support custom synchronization matching logic when transaction IDs (txids) are not available.

**New Features:**

- New utility method: `collection.utils.awaitMatch(matchFn, timeout?)` - Wait for custom match logic
- Export `isChangeMessage` and `isControlMessage` helper functions for custom match functions
- Type: `MatchFunction<T>` for custom match functions

**Example Usage:**

```typescript
const todosCollection = createCollection(
  electricCollectionOptions({
    onInsert: async ({ transaction, collection }) => {
      const newItem = transaction.mutations[0].modified
      await api.todos.create(newItem)

      // Wait for sync using custom match logic
      await collection.utils.awaitMatch(
        (message) => isChangeMessage(message) &&
                     message.headers.operation === 'insert' &&
                     message.value.text === newItem.text
      )
    }
  })
)
```

**Benefits:**

- Supports backends that can't provide transaction IDs
- Flexible heuristic-based matching
- Works with existing txid-based approach (backward compatible)
