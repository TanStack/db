---
title: LocalOnly Collection
---

# LocalOnly Collection

LocalOnly collections are designed for in-memory client data or UI state that doesn't need to persist across browser sessions or sync across tabs.

## Overview

The `localOnlyCollectionOptions` allows you to create collections that:
- Store data only in memory (no persistence)
- Support optimistic updates with automatic rollback on errors
- Provide optional initial data
- Work perfectly for temporary UI state and session-only data
- Automatically manage the transition from optimistic to confirmed state

## Installation

LocalOnly collections are included in the core TanStack DB package:

```bash
npm install @tanstack/react-db
```

## Basic Usage

```typescript
import { createCollection } from '@tanstack/react-db'
import { localOnlyCollectionOptions } from '@tanstack/react-db'

const uiStateCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'ui-state',
    getKey: (item) => item.id,
  })
)
```

### Direct Local Mutations

**Important:** LocalOnly collections work differently than server-synced collections. With LocalOnly collections, you **directly mutate state** by calling methods like `collection.insert()`, `collection.update()`, and `collection.delete()` — that's all you need to do. The changes are immediately applied to your local in-memory data.

This is different from collections that sync with a server (like Query Collection), where mutation handlers send data to a backend. With LocalOnly collections, everything stays local:

```typescript
// Just call the methods directly - no server sync involved
uiStateCollection.insert({ id: 'theme', mode: 'dark' })
uiStateCollection.update('theme', (draft) => { draft.mode = 'light' })
uiStateCollection.delete('theme')
```

## Configuration Options

The `localOnlyCollectionOptions` function accepts the following options:

### Required Options

- `id`: Unique identifier for the collection
- `getKey`: Function to extract the unique key from an item

### Optional Options

- `schema`: [Standard Schema](https://standardschema.dev) compatible schema (e.g., Zod, Effect) for client-side validation
- `initialData`: Array of items to populate the collection with on creation
- `onInsert`: Optional handler function called before confirming inserts
- `onUpdate`: Optional handler function called before confirming updates
- `onDelete`: Optional handler function called before confirming deletes

## Initial Data

Populate the collection with initial data on creation:

```typescript
const uiStateCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'ui-state',
    getKey: (item) => item.id,
    initialData: [
      { id: 'sidebar', isOpen: false },
      { id: 'theme', mode: 'light' },
      { id: 'modal', visible: false },
    ],
  })
)
```

## Mutation Handlers

Mutation handlers are **completely optional**. When provided, they are called before the optimistic state is confirmed:

```typescript
const tempDataCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'temp-data',
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      // Custom logic before confirming the insert
      console.log('Inserting:', transaction.mutations[0].modified)
    },
    onUpdate: async ({ transaction }) => {
      // Custom logic before confirming the update
      const { original, modified } = transaction.mutations[0]
      console.log('Updating from', original, 'to', modified)
    },
    onDelete: async ({ transaction }) => {
      // Custom logic before confirming the delete
      console.log('Deleting:', transaction.mutations[0].original)
    },
  })
)
```

## Manual Transactions

When using LocalOnly collections with manual transactions (created via `createTransaction`), you must call `utils.acceptMutations()` to persist the changes:

```typescript
import { createTransaction } from '@tanstack/react-db'

const localData = createCollection(
  localOnlyCollectionOptions({
    id: 'form-draft',
    getKey: (item) => item.id,
  })
)

const serverCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['items'],
    queryFn: async () => api.items.getAll(),
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      await api.items.create(transaction.mutations[0].modified)
    },
  })
)

const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Handle server collection mutations explicitly in mutationFn
    await Promise.all(
      transaction.mutations
        .filter((m) => m.collection === serverCollection)
        .map((m) => api.items.create(m.modified))
    )

    // After server mutations succeed, accept local collection mutations
    localData.utils.acceptMutations(transaction)
  },
})

// Apply mutations to both collections in one transaction
tx.mutate(() => {
  localData.insert({ id: 'draft-1', data: '...' })
  serverCollection.insert({ id: '1', name: 'Item' })
})

await tx.commit()
```

## Complete Example: Modal State Management

```typescript
import { createCollection } from '@tanstack/react-db'
import { localOnlyCollectionOptions } from '@tanstack/react-db'
import { useLiveQuery } from '@tanstack/react-db'
import { z } from 'zod'

// Define schema
const modalStateSchema = z.object({
  id: z.string(),
  isOpen: z.boolean(),
  data: z.any().optional(),
})

type ModalState = z.infer<typeof modalStateSchema>

// Create collection
export const modalStateCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'modal-state',
    getKey: (item) => item.id,
    schema: modalStateSchema,
    initialData: [
      { id: 'user-profile', isOpen: false },
      { id: 'settings', isOpen: false },
      { id: 'confirm-delete', isOpen: false },
    ],
  })
)

// Use in component
function UserProfileModal() {
  const { data: modals } = useLiveQuery((q) =>
    q.from({ modal: modalStateCollection })
      .where(({ modal }) => modal.id === 'user-profile')
  )

  const modalState = modals[0]

  const openModal = (data?: any) => {
    modalStateCollection.update('user-profile', (draft) => {
      draft.isOpen = true
      draft.data = data
    })
  }

  const closeModal = () => {
    modalStateCollection.update('user-profile', (draft) => {
      draft.isOpen = false
      draft.data = undefined
    })
  }

  if (!modalState?.isOpen) return null

  return (
    <div className="modal">
      <h2>User Profile</h2>
      <pre>{JSON.stringify(modalState.data, null, 2)}</pre>
      <button onClick={closeModal}>Close</button>
    </div>
  )
}
```

## Complete Example: Form Draft State

```typescript
import { createCollection } from '@tanstack/react-db'
import { localOnlyCollectionOptions } from '@tanstack/react-db'
import { useLiveQuery } from '@tanstack/react-db'

type FormDraft = {
  id: string
  formData: Record<string, any>
  lastModified: Date
}

// Create collection for form drafts
export const formDraftsCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'form-drafts',
    getKey: (item) => item.id,
  })
)

// Use in component
function CreatePostForm() {
  const { data: drafts } = useLiveQuery((q) =>
    q.from({ draft: formDraftsCollection })
      .where(({ draft }) => draft.id === 'new-post')
  )

  const currentDraft = drafts[0]

  const updateDraft = (field: string, value: any) => {
    if (currentDraft) {
      formDraftsCollection.update('new-post', (draft) => {
        draft.formData[field] = value
        draft.lastModified = new Date()
      })
    } else {
      formDraftsCollection.insert({
        id: 'new-post',
        formData: { [field]: value },
        lastModified: new Date(),
      })
    }
  }

  const clearDraft = () => {
    if (currentDraft) {
      formDraftsCollection.delete('new-post')
    }
  }

  const submitForm = async () => {
    if (!currentDraft) return

    await api.posts.create(currentDraft.formData)
    clearDraft()
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submitForm() }}>
      <input
        value={currentDraft?.formData.title || ''}
        onChange={(e) => updateDraft('title', e.target.value)}
      />
      <button type="submit">Publish</button>
      <button type="button" onClick={clearDraft}>Clear Draft</button>
    </form>
  )
}
```

## Use Cases

LocalOnly collections are perfect for:
- Temporary UI state (modals, sidebars, tooltips)
- Form draft data during the current session
- Client-side computed or derived data
- Wizard/multi-step form state
- Temporary filters or search state
- In-memory caches

## Comparison with LocalStorageCollection

| Feature | LocalOnly | LocalStorage |
|---------|-----------|--------------|
| Persistence | None (in-memory only) | localStorage |
| Cross-tab sync | No | Yes |
| Survives page reload | No | Yes |
| Performance | Fastest | Fast |
| Size limits | Memory limits | ~5-10MB |
| Best for | Temporary UI state | User preferences |

## Learn More

- [Optimistic Mutations](../guides/mutations.md)
- [Live Queries](../guides/live-queries.md)
- [LocalStorage Collection](./local-storage-collection.md)
