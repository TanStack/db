# Mutation Handlers

Define how mutations persist to your backend.

## Handler Types

| Handler    | Triggered By          | Use Case                |
| ---------- | --------------------- | ----------------------- |
| `onInsert` | `collection.insert()` | Create new records      |
| `onUpdate` | `collection.update()` | Modify existing records |
| `onDelete` | `collection.delete()` | Remove records          |

## Handler Signature

```tsx
type MutationHandler = (params: {
  transaction: Transaction
  collection: Collection
}) => Promise<any> | any

interface Transaction {
  mutations: PendingMutation[]
}

interface PendingMutation {
  collection: Collection
  type: 'insert' | 'update' | 'delete'
  key: string | number
  original: TData // Original item (update/delete only)
  modified: TData // New/modified item (insert/update)
  changes: Partial<TData> // Changed fields only (update only)
  metadata?: Record<string, unknown>
}
```

## Basic Handlers

```tsx
const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => api.todos.getAll(),
    getKey: (item) => item.id,

    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => api.todos.create(m.modified)),
      )
    },

    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          api.todos.update(m.original.id, m.changes),
        ),
      )
    },

    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => api.todos.delete(m.original.id)),
      )
    },
  }),
)
```

## Collection-Specific Patterns

### QueryCollection

Automatic refetch after handler completes:

```tsx
onUpdate: async ({ transaction }) => {
  await Promise.all(
    transaction.mutations.map((m) =>
      api.todos.update(m.original.id, m.changes),
    ),
  )
  // QueryCollection automatically refetches after this returns
}
```

### ElectricCollection

Return txid to wait for sync:

```tsx
onUpdate: async ({ transaction }) => {
  const txids = await Promise.all(
    transaction.mutations.map(async (m) => {
      const response = await api.todos.update(m.original.id, m.changes)
      return response.txid
    }),
  )
  return { txid: txids }
}
```

### LocalCollection

No handler needed (or use for side effects):

```tsx
// LocalStorage and LocalOnly don't require handlers
// But you can add them for side effects:
onUpdate: async ({ transaction }) => {
  analytics.track('settings_changed', {
    fields: Object.keys(transaction.mutations[0].changes),
  })
}
```

## Using Metadata

Customize behavior based on mutation metadata:

```tsx
// When mutating
todoCollection.update(todoId, { metadata: { intent: 'complete' } }, (draft) => {
  draft.completed = true
})

// In handler
onUpdate: async ({ transaction }) => {
  const mutation = transaction.mutations[0]

  if (mutation.metadata?.intent === 'complete') {
    // Use specialized endpoint
    await api.todos.complete(mutation.original.id)
  } else {
    // Generic update
    await api.todos.update(mutation.original.id, mutation.changes)
  }
}
```

## Batch Mutations

Handle multiple mutations efficiently:

```tsx
onUpdate: async ({ transaction }) => {
  // Single batch request instead of N requests
  await api.todos.batchUpdate(
    transaction.mutations.map((m) => ({
      id: m.original.id,
      changes: m.changes,
    })),
  )
}
```

## Shared Handler

Use the same handler for all operations:

```tsx
const mutationFn: MutationFn = async ({ transaction }) => {
  const response = await api.mutations.batch(
    transaction.mutations.map((m) => ({
      type: m.type,
      table: 'todos',
      key: m.key,
      data: m.type === 'delete' ? undefined : m.modified,
    })),
  )

  if (!response.ok) {
    throw new Error(`Mutation failed: ${response.status}`)
  }
}

const todoCollection = createCollection({
  onInsert: mutationFn,
  onUpdate: mutationFn,
  onDelete: mutationFn,
})
```

## Schema Transforms in Handlers

Handlers receive transformed data (TOutput):

```tsx
const schema = z.object({
  id: z.string(),
  created_at: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
})

onInsert: async ({ transaction }) => {
  const item = transaction.mutations[0].modified
  // item.created_at is already a Date!

  // Serialize for API if needed
  await api.create({
    ...item,
    created_at: item.created_at.toISOString(),
  })
}
```

## Error Handling

Throw errors to trigger rollback:

```tsx
onUpdate: async ({ transaction }) => {
  const response = await api.todos.update(...)

  if (!response.ok) {
    // This triggers optimistic state rollback
    throw new Error(`Update failed: ${response.status}`)
  }
}
```

## Handler Must Wait for Sync

**Critical:** Handlers must not resolve until server changes have synced back.

```tsx
// ✅ Correct: waits for refetch
onUpdate: async ({ transaction }) => {
  await api.update(...)
  await collection.utils.refetch()
}

// ✅ Correct: QueryCollection auto-refetches
onUpdate: async ({ transaction }) => {
  await api.update(...)
  // Auto-refetch happens after return
}

// ✅ Correct: Electric waits for txid
onUpdate: async ({ transaction }) => {
  const { txid } = await api.update(...)
  return { txid }
}

// ❌ Wrong: doesn't wait for sync
onUpdate: async ({ transaction }) => {
  api.update(...) // Fire and forget - will cause UI glitches
}
```
