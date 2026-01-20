---
'@tanstack/db': minor
'@tanstack/electric-db-collection': minor
'@tanstack/query-db-collection': minor
---

**BREAKING (TypeScript only)**: Deprecate returning values from mutation handlers (`onInsert`, `onUpdate`, `onDelete`).

**What's changed:**

- Handler types now default to `Promise<void>` instead of `Promise<any>`, indicating the new expected pattern
- Old return patterns (`return { refetch }`, `return { txid }`) still work at runtime with deprecation warnings
- **Deprecation warnings** are now logged when handlers return values
- Old patterns will be fully removed in v1.0

**New pattern (explicit sync coordination):**

- **Query Collections**: Call `await collection.utils.refetch()` to sync server state
- **Electric Collections**: Call `await collection.utils.awaitTxId(txid)` or `await collection.utils.awaitMatch(fn)` to wait for synchronization
- **Other Collections**: Use appropriate sync utilities for your collection type

This change makes the API more explicit and consistent across all collection types. All handlers should coordinate sync explicitly within the handler function using `await`, rather than relying on magic return values.

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
