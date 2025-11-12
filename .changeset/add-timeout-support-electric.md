---
"@tanstack/electric-db-collection": minor
---

Add timeout support to electricCollectionOptions matching strategies. You can now specify a custom timeout when returning txids from mutation handlers (onInsert, onUpdate, onDelete).

Previously, users could only customize timeouts when manually calling `collection.utils.awaitTxId()`, but not when using the automatic txid matching strategy.

**Example:**

```ts
const collection = createCollection(
  electricCollectionOptions({
    // ... other config
    onInsert: async ({ transaction }) => {
      const newItem = transaction.mutations[0].modified
      const result = await api.todos.create({ data: newItem })
      // Specify custom timeout (in milliseconds)
      return { txid: result.txid, timeout: 10000 }
    },
  })
)
```

The timeout parameter is optional and defaults to 5000ms when not specified. It works with both single txids and arrays of txids.
