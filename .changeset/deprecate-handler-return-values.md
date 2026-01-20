---
'@tanstack/db': minor
'@tanstack/electric-db-collection': minor
'@tanstack/query-db-collection': minor
---

**Deprecation**: Mutation handler return values and QueryCollection auto-refetch behavior.

**What's changed:**

- Handler types now default to `Promise<void>` instead of `Promise<any>`, indicating the new expected pattern
- **Deprecation warnings** are logged when deprecated patterns are used

**QueryCollection changes:**

- Auto-refetch after handlers is **deprecated** and will be removed in v1.0
- To skip auto-refetch now, return `{ refetch: false }` from your handler
- In v1.0: call `await collection.utils.refetch()` explicitly when needed, or omit to skip

**ElectricCollection changes:**

- Returning `{ txid }` is deprecated - use `await collection.utils.awaitTxId(txid)` instead

**Migration guide:**

```typescript
// QueryCollection - skip refetch (current)
onInsert: async ({ transaction }) => {
  await api.create(transaction.mutations[0].modified)
  return { refetch: false } // Opt out of auto-refetch
}

// QueryCollection - with refetch (v1.0 pattern)
onInsert: async ({ transaction, collection }) => {
  await api.create(transaction.mutations[0].modified)
  await collection.utils.refetch() // Explicit refetch
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
