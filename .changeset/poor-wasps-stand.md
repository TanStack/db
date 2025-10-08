---
"@tanstack/electric-db-collection": minor
---

feat: Add awaitMatch utility and reduce default timeout (#402)

Adds a new `awaitMatch` utility function to support custom synchronization matching logic when transaction IDs (txids) are not available. Also reduces the default timeout for `awaitTxId` from 30 seconds to 5 seconds for faster feedback.

**New Features:**

- New utility method: `collection.utils.awaitMatch(matchFn, timeout?)` - Wait for custom match logic
- Export `isChangeMessage` and `isControlMessage` helper functions for custom match functions
- Type: `MatchFunction<T>` for custom match functions

**Breaking Changes:**

- Default timeout for `awaitTxId` reduced from 30 seconds to 5 seconds

**Example Usage:**

```typescript
import { isChangeMessage } from "@tanstack/electric-db-collection"

const todosCollection = createCollection(
  electricCollectionOptions({
    onInsert: async ({ transaction, collection }) => {
      const newItem = transaction.mutations[0].modified
      await api.todos.create(newItem)

      // Wait for sync using custom match logic
      await collection.utils.awaitMatch(
        (message) =>
          isChangeMessage(message) &&
          message.headers.operation === "insert" &&
          message.value.text === newItem.text,
        5000 // timeout in ms (optional, defaults to 5000)
      )
    },
  })
)
```

**Benefits:**

- Supports backends that can't provide transaction IDs
- Flexible heuristic-based matching
- Works with existing txid-based approach (backward compatible)
- Faster feedback on sync issues with reduced timeout
