---
name: db-core/mutations-optimistic
description: >
  Writing data to collections with instant optimistic feedback. Covers
  collection.insert(), collection.update() with Immer-style draft proxy,
  collection.delete(). createOptimisticAction, createPacedMutations with
  debounceStrategy/throttleStrategy/queueStrategy. createTransaction for
  manual transaction control. getActiveTransaction for ambient context.
  Transaction lifecycle (pending/persisting/completed/failed), transaction
  stacking, mutation merging, PendingMutation type, rollback, isPersisted.
type: sub-skill
library: db
library_version: "0.5.29"
sources:
  - "TanStack/db:docs/guides/mutations.md"
  - "TanStack/db:packages/db/src/collection/mutations.ts"
  - "TanStack/db:packages/db/src/transactions.ts"
  - "TanStack/db:packages/db/src/optimistic-action.ts"
---

# Mutations & Optimistic State

## Setup

Mutations apply optimistically — the UI updates instantly, then the handler
persists to the backend. If the handler fails, the optimistic state
automatically rolls back.

```typescript
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: () => fetch('/api/todos').then((r) => r.json()),
    getKey: (todo) => todo.id,
    onInsert: async ({ transaction }) => {
      const item = transaction.mutations[0].modified
      await fetch('/api/todos', {
        method: 'POST',
        body: JSON.stringify(item),
      })
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      await fetch(`/api/todos/${original.id}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      await fetch(`/api/todos/${original.id}`, { method: 'DELETE' })
    },
  })
)
```

## Core Patterns

### Insert, update, and delete

```typescript
// Insert — pass the full object
todosCollection.insert({
  id: crypto.randomUUID(),
  text: 'Buy milk',
  completed: false,
})

// Update — mutate the draft (Immer-style proxy)
todosCollection.update(todo.id, (draft) => {
  draft.completed = true
  draft.completedAt = new Date()
})

// Delete
todosCollection.delete(todo.id)

// Batch operations
todosCollection.insert([item1, item2, item3])
todosCollection.delete([id1, id2, id3])
```

Every mutation returns a `Transaction` object for tracking persistence.

### Awaiting persistence

```typescript
const tx = todosCollection.update(todo.id, (draft) => {
  draft.text = 'Updated text'
})

// tx.isPersisted is a Deferred — await its .promise
try {
  await tx.isPersisted.promise
  console.log('Saved to server')
} catch (error) {
  console.log('Failed — optimistic state was rolled back')
}
```

### Custom optimistic actions

For complex mutations that span multiple operations or need custom
optimistic logic:

```typescript
import { createOptimisticAction } from '@tanstack/db'

const addTodo = createOptimisticAction({
  onMutate: (text: string) => {
    // Synchronous — applies optimistic state immediately
    todosCollection.insert({
      id: crypto.randomUUID(),
      text,
      completed: false,
    })
  },
  mutationFn: async (text, { transaction }) => {
    await fetch('/api/todos', {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
    // Refetch to get server-generated fields
    await todosCollection.utils.refetch()
  },
})

// Usage
const tx = addTodo('Buy milk')
await tx.isPersisted.promise
```

### Manual transactions across multiple collections

```typescript
import { createTransaction } from '@tanstack/db'

const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    for (const mutation of transaction.mutations) {
      if (mutation.type === 'insert') {
        await api.create(mutation.modified)
      } else if (mutation.type === 'update') {
        await api.update(mutation.original.id, mutation.changes)
      }
    }
  },
})

// Group mutations into one transaction
tx.mutate(() => {
  todosCollection.insert({ id: '1', text: 'Task A', completed: false })
  projectsCollection.update('proj-1', (draft) => {
    draft.taskCount += 1
  })
})

await tx.commit()
```

### Paced mutations for real-time editing

```typescript
import { createPacedMutations, debounceStrategy } from '@tanstack/db'

const updateTitle = createPacedMutations({
  onMutate: ({ id, title }: { id: string; title: string }) => {
    todosCollection.update(id, (draft) => {
      draft.title = title
    })
  },
  mutationFn: async ({ id, title }) => {
    await fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
  },
  strategy: debounceStrategy({ wait: 500 }),
})

// Each keystroke calls this — only persists after 500ms pause
updateTitle({ id: todo.id, title: newValue })
```

Strategies: `debounceStrategy`, `throttleStrategy`, `queueStrategy`.

### Transaction lifecycle and mutation merging

Transaction states: `pending` → `persisting` → `completed` | `failed`

Multiple mutations on the same item within a transaction merge:
- insert + update → insert (with merged fields)
- insert + delete → cancelled (both removed)
- update + update → update (union of changes)
- update + delete → delete

### PendingMutation structure

Inside `mutationFn`, access mutation details via `transaction.mutations`:

```typescript
mutationFn: async ({ transaction }) => {
  for (const mutation of transaction.mutations) {
    mutation.type       // 'insert' | 'update' | 'delete'
    mutation.original   // pre-mutation state (empty object for inserts)
    mutation.modified   // post-mutation state
    mutation.changes    // only the changed fields (for updates)
    mutation.key        // item key
    mutation.collection // source collection
  }
}
```

## Common Mistakes

### CRITICAL — Passing a new object to update() instead of mutating the draft

Wrong:
```typescript
todosCollection.update(todo.id, { ...todo, completed: true })
```

Correct:
```typescript
todosCollection.update(todo.id, (draft) => {
  draft.completed = true
})
```

The update API uses an Immer-style draft proxy. The second argument must
be a callback that mutates the draft, not a replacement object. This is
the single most common mutation mistake.

Source: maintainer interview

### CRITICAL — Hallucinating mutation API signatures

Wrong:
```typescript
// Invented signatures that look plausible but are wrong
todosCollection.update(todo.id, { title: 'new' })
todosCollection.upsert(todo)
createTransaction({ onSuccess: () => {} })
transaction.mutations[0].data  // wrong property name
```

Correct:
```typescript
todosCollection.update(todo.id, (draft) => { draft.title = 'new' })
todosCollection.insert(todo)
createTransaction({ mutationFn: async ({ transaction }) => {} })
transaction.mutations[0].changes  // correct property name
```

Read the actual API before writing mutation code. Key signatures:
- `update(key, (draft) => void)` — draft callback, not object
- `insert(item)` — not upsert
- `createTransaction({ mutationFn })` — not onSuccess
- `mutation.changes` — not mutation.data

Source: maintainer interview

### CRITICAL — onMutate callback returning a Promise

Wrong:
```typescript
createOptimisticAction({
  onMutate: async (text) => {
    const id = await generateId()
    todosCollection.insert({ id, text, completed: false })
  },
  mutationFn: async (text) => { /* ... */ },
})
```

Correct:
```typescript
createOptimisticAction({
  onMutate: (text) => {
    const id = crypto.randomUUID()
    todosCollection.insert({ id, text, completed: false })
  },
  mutationFn: async (text) => { /* ... */ },
})
```

`onMutate` must be synchronous — optimistic state needs to apply in the
current tick. Returning a Promise throws `OnMutateMustBeSynchronousError`.

Source: packages/db/src/optimistic-action.ts:75

### CRITICAL — Calling insert/update/delete without handler or ambient transaction

Wrong:
```typescript
const collection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: () => fetch('/api/todos').then((r) => r.json()),
    getKey: (t) => t.id,
    // No onInsert handler
  })
)

collection.insert({ id: '1', text: 'test', completed: false })
// Throws MissingInsertHandlerError
```

Correct:
```typescript
const collection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: () => fetch('/api/todos').then((r) => r.json()),
    getKey: (t) => t.id,
    onInsert: async ({ transaction }) => {
      await api.createTodo(transaction.mutations[0].modified)
    },
  })
)

collection.insert({ id: '1', text: 'test', completed: false })
```

Collection mutations require either an `onInsert`/`onUpdate`/`onDelete`
handler or an ambient transaction from `createTransaction`. Without either,
throws `MissingInsertHandlerError` (or the Update/Delete variant).

Source: packages/db/src/collection/mutations.ts:166

### HIGH — Calling .mutate() after transaction is no longer pending

Wrong:
```typescript
const tx = createTransaction({ mutationFn: async () => {} })
tx.mutate(() => { todosCollection.insert(item1) })
await tx.commit()
tx.mutate(() => { todosCollection.insert(item2) })
// Throws TransactionNotPendingMutateError
```

Correct:
```typescript
const tx = createTransaction({
  autoCommit: false,
  mutationFn: async () => {},
})
tx.mutate(() => { todosCollection.insert(item1) })
tx.mutate(() => { todosCollection.insert(item2) })
await tx.commit()
```

Transactions only accept mutations while in `pending` state. After
`commit()` or `rollback()`, calling `mutate()` throws. Use
`autoCommit: false` to batch multiple `mutate()` calls.

Source: packages/db/src/transactions.ts:289

### HIGH — Attempting to change an item's primary key via update

Wrong:
```typescript
todosCollection.update('old-id', (draft) => {
  draft.id = 'new-id'
})
```

Correct:
```typescript
todosCollection.delete('old-id')
todosCollection.insert({ ...todo, id: 'new-id' })
```

Primary keys are immutable. The update proxy detects key changes and
throws `KeyUpdateNotAllowedError`. To change a key, delete and re-insert.

Source: packages/db/src/collection/mutations.ts:352

### HIGH — Inserting item with duplicate key

Wrong:
```typescript
todosCollection.insert({ id: 'abc', text: 'First' })
todosCollection.insert({ id: 'abc', text: 'Second' })
// Throws DuplicateKeyError
```

Correct:
```typescript
todosCollection.insert({ id: crypto.randomUUID(), text: 'First' })
todosCollection.insert({ id: crypto.randomUUID(), text: 'Second' })
```

If an item with the same key exists (synced or optimistic), throws
`DuplicateKeyError`. Use unique IDs — `crypto.randomUUID()` or a
server-generated ID.

Source: packages/db/src/collection/mutations.ts:181

### HIGH — Not awaiting refetch after mutation in query collection handler

Wrong:
```typescript
queryCollectionOptions({
  onInsert: async ({ transaction }) => {
    await api.createTodo(transaction.mutations[0].modified)
    // Handler resolves → optimistic state dropped
    // Server state hasn't arrived yet → flash of missing data
  },
})
```

Correct:
```typescript
queryCollectionOptions({
  onInsert: async ({ transaction }) => {
    await api.createTodo(transaction.mutations[0].modified)
    await todosCollection.utils.refetch()
    // Server state is now in the collection before optimistic state drops
  },
})
```

Optimistic state is held until the handler resolves. If you don't await
the refetch, the optimistic state drops before server state arrives,
causing a brief flash of missing data.

Source: docs/overview.md — optimistic state lifecycle
