---
'@tanstack/db': minor
'@tanstack/electric-db-collection': minor
'@tanstack/query-db-collection': minor
---

**Deprecation**: Mutation handler return values and QueryCollection auto-refetch behavior.

**What's changed:**

- Handler return values remain type-compatible during the deprecation window
- **Deprecation warnings** are logged when deprecated patterns are used

**QueryCollection changes:**

- Auto-refetch after handlers is **deprecated** and will be removed in v1.0
- To skip auto-refetch now, return `{ refetch: false }` from your handler
- To migrate to explicit refetch now, await `collection.utils.refetch()` and return `{ refetch: false }` to prevent a second fetch; remove the return in v1.0
- In v1.0, call `await collection.utils.refetch()` explicitly when needed, or omit it to skip

**ElectricCollection changes:**

- Returning `{ txid }` is deprecated - use `await collection.utils.awaitTxId(txid)` instead
- The default `awaitTxId` and `awaitMatch` timeouts increase to 15 seconds

**Migration guide:**

```typescript
// QueryCollection - skip refetch (current)
onInsert: async ({ transaction }) => {
  await api.create(transaction.mutations[0].modified)
  return { refetch: false } // Opt out of auto-refetch
}

// QueryCollection - migrate to explicit refetch now
onInsert: async ({ transaction, collection }) => {
  await api.create(transaction.mutations[0].modified)
  await collection.utils.refetch() // Explicit refetch
  return { refetch: false } // Prevent a second pre-1.0 refetch; remove in v1.0
}

// ElectricCollection - before
onInsert: async ({ transaction }) => {
  const result = await api.create(transaction.mutations[0].modified)
  return { txid: result.txid } // Deprecated
}

// ElectricCollection - after
onInsert: async ({ transaction, collection }) => {
  const result = await api.create(transaction.mutations[0].modified)
  await collection.utils.awaitTxId(result.txid) // Explicit
}
```
