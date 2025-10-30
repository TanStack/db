---
"@tanstack/db": minor
---

Add stable `viewKey` support to prevent UI re-renders during temporary-to-real ID transitions. When inserting items with temporary IDs that are later replaced by server-generated IDs, React components would previously unmount and remount, causing loss of focus and visual flicker.

Collections can now be configured with a `viewKey` function to generate stable keys:

```typescript
const todoCollection = createCollection({
  getKey: (item) => item.id,
  viewKey: () => crypto.randomUUID(),
  onInsert: async ({ transaction }) => {
    const tempId = transaction.mutations[0].modified.id
    const response = await api.create(...)

    // Link temporary and real IDs to same viewKey
    todoCollection.mapViewKey(tempId, response.id)
    await todoCollection.utils.refetch()
  },
})

// Use stable keys in React
<li key={todoCollection.getViewKey(todo.id)}>
```

New APIs:
- `collection.getViewKey(key)` - Returns stable viewKey for any key (temporary or real)
- `collection.mapViewKey(tempKey, realKey)` - Links temporary and real IDs to share the same viewKey
- `viewKey` configuration option - Function to generate stable view keys for inserted items
