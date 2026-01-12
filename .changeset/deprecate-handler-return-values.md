---
'@tanstack/db': major
'@tanstack/electric-db-collection': major
'@tanstack/query-db-collection': major
---

**BREAKING (TypeScript only)**: Deprecate returning values from mutation handlers (`onInsert`, `onUpdate`, `onDelete`).

**What's changed:**

- Handler types now default to `Promise<void>` instead of `Promise<any>`
- TypeScript will error on `return { refetch: false }` or `return { txid }`
- Runtime still supports old return patterns for backward compatibility
- **Deprecation warnings** are now logged when handlers return values
- Old patterns will be fully removed in v1.0 RC

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
