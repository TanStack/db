---
'@tanstack/db': patch
---

Added `onSyncWhilePersisting` callback to collection sync config for fine-grained control over whether synced data should be applied while optimistic transactions are persisting.

The callback receives context about pending sync operations and persisting transactions, allowing developers to make selective decisions:

```typescript
sync: {
  sync: ({ begin, write, commit }) => { /* ... */ },
  // Allow sync only when there are no conflicting keys
  onSyncWhilePersisting: ({ conflictingKeys }) => conflictingKeys.size === 0,
}
```

Context provided to the callback:

- `pendingSyncKeys` - Keys of items in pending sync operations
- `persistingKeys` - Keys being modified by persisting optimistic transactions
- `conflictingKeys` - Keys that appear in both (potential conflicts)
- `persistingTransactionCount` - Number of persisting transactions
- `isTruncate` - Whether this includes a truncate operation

If no callback is provided, sync is deferred while any optimistic transaction is persisting (the safe default). Truncate operations always proceed regardless of the callback.
