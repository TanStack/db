---
name: tanstack-db-mutations
description: |
  Mutation patterns in TanStack DB.
  Use for insert/update/delete, optimistic updates, transactions, paced mutations, and error handling.
---

# Mutations

TanStack DB mutations follow optimistic update → server persist → sync back flow. Changes appear instantly, then confirm or rollback based on server response.

## Common Patterns

### Collection-Level Mutations

```tsx
// Insert
todoCollection.insert({
  id: crypto.randomUUID(),
  text: 'Buy groceries',
  completed: false,
})

// Insert multiple
todoCollection.insert([
  { id: '1', text: 'Task 1', completed: false },
  { id: '2', text: 'Task 2', completed: false },
])

// Update (Immer-style draft)
todoCollection.update(todoId, (draft) => {
  draft.completed = true
  draft.completedAt = new Date()
})

// Update multiple
todoCollection.update([id1, id2], (drafts) => {
  drafts.forEach((draft) => {
    draft.completed = true
  })
})

// Delete
todoCollection.delete(todoId)

// Delete multiple
todoCollection.delete([id1, id2])
```

### Mutation Handlers

Define handlers when creating collections to persist mutations:

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

### Custom Actions with createOptimisticAction

For intent-based mutations or multi-collection changes:

```tsx
import { createOptimisticAction } from '@tanstack/react-db'

const likePost = createOptimisticAction<string>({
  onMutate: (postId) => {
    // Optimistic update (guess at change)
    postCollection.update(postId, (draft) => {
      draft.likeCount += 1
      draft.likedByMe = true
    })
  },
  mutationFn: async (postId) => {
    // Send intent to server
    await api.posts.like(postId)
    // Wait for sync back
    await postCollection.utils.refetch()
  },
})

// Use it
likePost(postId)
```

### Multi-Collection Actions

```tsx
const createProject = createOptimisticAction<{ name: string; ownerId: string }>(
  {
    onMutate: ({ name, ownerId }) => {
      const projectId = crypto.randomUUID()

      projectCollection.insert({
        id: projectId,
        name,
        ownerId,
        createdAt: new Date(),
      })

      userCollection.update(ownerId, (draft) => {
        draft.projectCount += 1
      })
    },
    mutationFn: async ({ name, ownerId }) => {
      await api.projects.create({ name, ownerId })
      await Promise.all([
        projectCollection.utils.refetch(),
        userCollection.utils.refetch(),
      ])
    },
  },
)
```

### Manual Transactions

For batch mutations with explicit commit control:

```tsx
import { createTransaction } from '@tanstack/react-db'

const reviewTx = createTransaction({
  autoCommit: false, // Wait for explicit commit
  mutationFn: async ({ transaction }) => {
    await api.batchUpdate(transaction.mutations)
  },
})

// Accumulate changes
reviewTx.mutate(() => {
  todoCollection.update(id1, (d) => {
    d.status = 'reviewed'
  })
  todoCollection.update(id2, (d) => {
    d.status = 'reviewed'
  })
})

// User reviews changes...

// Add more changes
reviewTx.mutate(() => {
  todoCollection.update(id3, (d) => {
    d.status = 'reviewed'
  })
})

// Commit all at once
await reviewTx.commit()
// Or rollback
// reviewTx.rollback()
```

### Paced Mutations (Debounce/Throttle/Queue)

```tsx
import {
  usePacedMutations,
  debounceStrategy,
  throttleStrategy,
  queueStrategy,
} from '@tanstack/react-db'

// Debounce: Wait for inactivity (auto-save forms)
const mutate = usePacedMutations<{ field: string; value: string }>({
  onMutate: ({ field, value }) => {
    formCollection.update(formId, (draft) => {
      draft[field] = value
    })
  },
  mutationFn: async ({ transaction }) => {
    await api.forms.save(transaction.mutations)
  },
  strategy: debounceStrategy({ wait: 500 }),
})

// Throttle: Minimum spacing (sliders)
const mutate = usePacedMutations<number>({
  onMutate: (volume) => {
    settingsCollection.update('volume', (d) => {
      d.value = volume
    })
  },
  mutationFn: async ({ transaction }) => {
    await api.settings.updateVolume(transaction.mutations)
  },
  strategy: throttleStrategy({ wait: 200, leading: true, trailing: true }),
})

// Queue: Sequential processing (file uploads)
const mutate = usePacedMutations<File>({
  onMutate: (file) => {
    uploadCollection.insert({
      id: crypto.randomUUID(),
      file,
      status: 'pending',
    })
  },
  mutationFn: async ({ transaction }) => {
    await api.files.upload(transaction.mutations[0].modified)
  },
  strategy: queueStrategy({ wait: 500 }),
})
```

### Non-Optimistic Mutations

Wait for server confirmation before showing change:

```tsx
// Insert without optimistic update
const tx = todoCollection.insert(
  { id: '1', text: 'Server-validated', completed: false },
  { optimistic: false },
)

// Wait for persistence
try {
  await tx.isPersisted.promise
  navigate('/success')
} catch (error) {
  toast.error('Failed to create')
}
```

### Mutation with Metadata

Annotate mutations for custom handler behavior:

```tsx
todoCollection.update(todoId, { metadata: { intent: 'complete' } }, (draft) => {
  draft.completed = true
})

// In handler
onUpdate: async ({ transaction }) => {
  const mutation = transaction.mutations[0]
  if (mutation.metadata?.intent === 'complete') {
    await api.todos.complete(mutation.original.id)
  } else {
    await api.todos.update(mutation.original.id, mutation.changes)
  }
}
```

### Waiting for Persistence

```tsx
const tx = todoCollection.update(todoId, (draft) => {
  draft.completed = true
})

// Check state
console.log(tx.state) // 'pending' | 'persisting' | 'completed' | 'failed'

// Wait for completion
try {
  await tx.isPersisted.promise
  console.log('Saved!')
} catch (error) {
  console.log('Failed:', error)
}
```

### Handling Temporary IDs

When server generates the real ID:

```tsx
// Option 1: Use client-generated UUIDs (recommended)
todoCollection.insert({
  id: crypto.randomUUID(), // Stable ID, no flicker
  text: 'New todo',
})

// Option 2: Wait for persistence before enabling delete
const tx = todoCollection.insert({ id: tempId, text: 'New todo' })
await tx.isPersisted.promise
// Now safe to delete with real ID
```

## Transaction Handler API

```tsx
interface OperationHandler {
  ({ transaction, collection }): Promise<any>
}

// transaction.mutations array:
interface PendingMutation {
  collection: Collection
  type: 'insert' | 'update' | 'delete'
  key: string | number
  original: TData // Original item (update/delete)
  modified: TData // New item (insert/update)
  changes: Partial<TData> // Only changed fields (update)
  metadata?: Record<string, unknown>
}
```

## Mutation Merging

Multiple mutations on same item within a transaction merge:

| Existing → New  | Result    | Description                    |
| --------------- | --------- | ------------------------------ |
| insert + update | `insert`  | Merged into single insert      |
| insert + delete | _removed_ | Cancel out                     |
| update + delete | `delete`  | Delete wins                    |
| update + update | `update`  | Changes merged, first original |

## Detailed References

| Reference                       | When to Use                                    |
| ------------------------------- | ---------------------------------------------- |
| `references/handlers.md`        | Handler patterns, collection-specific behavior |
| `references/transactions.md`    | Manual transactions, autoCommit, lifecycle     |
| `references/paced-mutations.md` | Debounce, throttle, queue strategies           |
| `references/error-handling.md`  | Rollback, retry patterns, error recovery       |
| `references/temporary-ids.md`   | Server-generated IDs, view key mapping         |
