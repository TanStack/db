---
"@tanstack/db": major
"@tanstack/electric-db-collection": major
"@tanstack/query-db-collection": major
---

**BREAKING**: Deprecate returning values from mutation handlers (`onInsert`, `onUpdate`, `onDelete`). Instead, use explicit sync coordination:

- **Query Collections**: Call `await collection.utils.refetch()` to sync server state
- **Electric Collections**: Call `await collection.utils.awaitTxId(txid)` or `await collection.utils.awaitMatch(fn)` to wait for synchronization
- **Other Collections**: Use appropriate sync utilities for your collection type

This change makes the API more explicit and consistent across all collection types. Magic return values like `{ refetch: false }` in Query Collections and `{ txid }` in Electric Collections are now deprecated. All handlers should coordinate sync explicitly within the handler function.

Migration guide:

```typescript
// Before (Query Collection)
onInsert: async ({ transaction }) => {
  await api.create(transaction.mutations[0].modified)
  // Implicitly refetches
}

// After (Query Collection)
onInsert: async ({ transaction, collection }) => {
  await api.create(transaction.mutations[0].modified)
  await collection.utils.refetch()
}

// Before (Electric Collection)
onInsert: async ({ transaction }) => {
  const result = await api.create(transaction.mutations[0].modified)
  return { txid: result.txid }
}

// After (Electric Collection)
onInsert: async ({ transaction, collection }) => {
  const result = await api.create(transaction.mutations[0].modified)
  await collection.utils.awaitTxId(result.txid)
}
```
