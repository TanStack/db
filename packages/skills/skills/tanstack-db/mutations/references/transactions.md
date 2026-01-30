# Manual Transactions

Full control over mutation batching and commit timing.

## When to Use

- Batch multiple mutations into single server request
- Multi-step workflows with user review
- Explicit commit/rollback control
- Mutations spanning multiple user interactions

## Creating Transactions

```tsx
import { createTransaction } from '@tanstack/react-db'

const tx = createTransaction({
  autoCommit: false, // Wait for explicit commit
  mutationFn: async ({ transaction }) => {
    await api.batchUpdate(transaction.mutations)
  },
})
```

## Configuration Options

```tsx
createTransaction({
  id?: string,              // Optional unique ID
  autoCommit?: boolean,     // Default: true
  mutationFn: MutationFn,   // Persistence function
  metadata?: Record<string, unknown>,
})
```

| Option | Default | Description |
|--------|---------|-------------|
| `autoCommit` | `true` | Commit immediately after mutate() |
| `id` | auto-generated | Transaction identifier |
| `metadata` | undefined | Custom data attached to transaction |

## Transaction Methods

### mutate()

Apply mutations within the transaction:

```tsx
tx.mutate(() => {
  collection.insert(item)
  collection.update(key, (draft) => { ... })
  collection.delete(key)
})
```

### commit()

Persist all mutations:

```tsx
await tx.commit()
```

### rollback()

Discard all optimistic changes:

```tsx
tx.rollback()
```

## Basic Workflow

```tsx
const tx = createTransaction({
  autoCommit: false,
  mutationFn: async ({ transaction }) => {
    await api.batchSave(transaction.mutations)
  },
})

// Step 1: User makes changes
tx.mutate(() => {
  todoCollection.update(id1, (d) => { d.status = 'reviewed' })
})

// Step 2: User adds more changes
tx.mutate(() => {
  todoCollection.update(id2, (d) => { d.status = 'reviewed' })
})

// Step 3: User confirms
await tx.commit()
// OR cancels
// tx.rollback()
```

## Transaction States

```tsx
tx.state // 'pending' | 'persisting' | 'completed' | 'failed'
```

| State | Description |
|-------|-------------|
| `pending` | Accepting mutations, not yet committed |
| `persisting` | mutationFn is running |
| `completed` | Successfully persisted |
| `failed` | mutationFn threw error |

## Waiting for Completion

```tsx
// Promise-based
try {
  await tx.isPersisted.promise
  console.log('Saved!')
} catch (error) {
  console.log('Failed:', error)
}

// Check state
if (tx.state === 'completed') {
  navigate('/success')
}
```

## Auto-Commit Mode

When `autoCommit: true` (default), each `mutate()` commits immediately:

```tsx
const tx = createTransaction({
  autoCommit: true, // Default
  mutationFn: async ({ transaction }) => {
    await api.save(transaction.mutations)
  },
})

// This commits immediately
tx.mutate(() => {
  todoCollection.insert(newTodo)
})
```

## With Local Collections

Local collections need explicit mutation acceptance:

```tsx
const localCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'drafts',
    getKey: (item) => item.id,
  })
)

const tx = createTransaction({
  autoCommit: false,
  mutationFn: async ({ transaction }) => {
    // Handle server mutations first
    await api.save(...)

    // Then accept local collection mutations
    localCollection.utils.acceptMutations(transaction)
  },
})

tx.mutate(() => {
  localCollection.insert({ id: '1', data: 'draft' })
})

await tx.commit()
```

## Combining Local and Server Collections

```tsx
const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Server mutations
    const serverMutations = transaction.mutations.filter(
      (m) => m.collection !== localSettings
    )
    await api.save(serverMutations)

    // Local mutations
    localSettings.utils.acceptMutations(transaction)
  },
})

tx.mutate(() => {
  // Both in same transaction
  userProfile.update('user-1', (d) => { d.name = 'New Name' })
  localSettings.update('theme', (d) => { d.mode = 'dark' })
})
```

## Error Handling

Failed transactions automatically rollback optimistic state:

```tsx
const tx = createTransaction({
  autoCommit: false,
  mutationFn: async ({ transaction }) => {
    const response = await api.save(transaction.mutations)
    if (!response.ok) {
      throw new Error('Save failed')
    }
  },
})

tx.mutate(() => {
  todoCollection.update(id, (d) => { d.status = 'done' })
})

try {
  await tx.commit()
} catch (error) {
  // Optimistic state already rolled back
  toast.error('Failed to save changes')
}
```

## Transaction with Custom Actions

Combine with createOptimisticAction:

```tsx
const archiveProject = createOptimisticAction<string>({
  onMutate: (projectId) => {
    // These mutations are wrapped in an auto-committed transaction
    projectCollection.update(projectId, (d) => { d.archived = true })
    taskCollection.update(
      taskCollection.toArray
        .filter((t) => t.projectId === projectId)
        .map((t) => t.id),
      (drafts) => {
        drafts.forEach((d) => { d.archived = true })
      }
    )
  },
  mutationFn: async (projectId) => {
    await api.projects.archive(projectId)
    await Promise.all([
      projectCollection.utils.refetch(),
      taskCollection.utils.refetch(),
    ])
  },
})
```
