---
"@tanstack/db": patch
---

Fix optimistic state not being replaced by server data when using writeInsert in mutation handlers

Previously, when using `writeInsert()` inside an `onInsert` handler to sync server-generated data back to the collection, the optimistic client-side data would not be replaced by the actual server data. This meant that temporary client-side values (like negative IDs) would persist even after the server returned the real values.

**Example of the issue:**

```ts
const todosCollection = createCollection(
  queryCollectionOptions({
    // ...
    onInsert: async ({ transaction }) => {
      const newItems = transaction.mutations.map((m) => m.modified)
      const serverItems = await createTodos(newItems)

      todosCollection.utils.writeBatch(() => {
        serverItems.forEach((serverItem) => {
          todosCollection.utils.writeInsert(serverItem)
        })
      })

      return { refetch: false }
    },
  })
)

// User inserts with temporary ID
todosCollection.insert({
  id: -1234, // Temporary negative ID
  title: "Task",
})

// Server returns real ID, but UI would still show -1234 instead of the real ID
```

This has been fixed by preventing optimistic state from `persisting` transactions from being re-applied during server data synchronization. The UI now correctly updates to show server-generated values once they are synced via `writeInsert()`.
