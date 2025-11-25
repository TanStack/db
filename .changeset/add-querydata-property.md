---
"@tanstack/query-db-collection": patch
---

Add `queryData` property to `collection.utils` for accessing full query response including metadata. This resolves the common use case of needing pagination info (total counts, page numbers, etc.) alongside the data array when using the `select` option.

Previously, when using `select` to extract an array from a wrapped API response, metadata was only accessible via `queryClient.getQueryData()` which was not reactive and required exposing the queryClient. Users resorted to duplicating metadata into every item as a workaround.

**Example:**

```ts
const contactsCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['contacts'],
    queryFn: async () => {
      const response = await api.getContacts()
      // API returns: { data: Contact[], pagination: { total: number } }
      return response.json()
    },
    select: (response) => response.data, // Extract array for collection
    queryClient,
    getKey: (contact) => contact.id,
  })
)

// Access the full response including metadata
const totalCount = contactsCollection.utils.queryData?.pagination?.total

// Perfect for TanStack Table pagination
function ContactsTable() {
  const contacts = useLiveQuery(contactsCollection)
  const totalRowCount = contactsCollection.utils.queryData?.total ?? 0

  const table = useReactTable({
    data: contacts,
    columns,
    rowCount: totalRowCount,
  })

  return <TableComponent table={table} />
}
```

**Benefits:**

- Type-safe metadata access (TypeScript infers type from `queryFn` return)
- Reactive updates when query refetches
- Works seamlessly with existing `select` function
- No need to duplicate metadata into items
- Cleaner API than accessing `queryClient` directly

The property is `undefined` before the first successful fetch and updates automatically on refetches.
