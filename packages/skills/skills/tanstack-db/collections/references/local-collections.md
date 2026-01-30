# Local Collections

In-memory and localStorage-backed collections for client-only state.

## LocalOnlyCollection

In-memory state, lost on refresh:

```tsx
import {
  createCollection,
  localOnlyCollectionOptions,
} from '@tanstack/react-db'

const uiStateCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'ui-state',
    getKey: (item) => item.id,
  }),
)

// Use for temporary state
uiStateCollection.insert({ id: 'sidebar', expanded: true })
uiStateCollection.insert({ id: 'modal', open: false })

// Query like any collection
const { data } = useLiveQuery((q) => q.from({ state: uiStateCollection }))
```

## LocalStorageCollection

Persists to localStorage, syncs across tabs:

```tsx
import {
  createCollection,
  localStorageCollectionOptions,
} from '@tanstack/react-db'

const settingsCollection = createCollection(
  localStorageCollectionOptions({
    id: 'user-settings',
    storageKey: 'app-settings', // localStorage key
    getKey: (item) => item.id,
  }),
)

// Persists across sessions
settingsCollection.insert({ id: 'theme', value: 'dark' })
settingsCollection.insert({ id: 'language', value: 'en' })

// Syncs across browser tabs automatically
```

## Configuration

```tsx
localOnlyCollectionOptions({
  id: string,                   // Collection identifier
  getKey: (item) => Key,        // Extract unique key
  schema?: StandardSchema,      // Optional validation
})

localStorageCollectionOptions({
  id: string,                   // Collection identifier
  storageKey: string,           // localStorage key
  getKey: (item) => Key,        // Extract unique key
  schema?: StandardSchema,      // Optional validation
})
```

## No Mutation Handlers

Local collections don't need `onInsert`/`onUpdate`/`onDelete` since there's no server. Mutations apply directly.

```tsx
// Just works, no handlers needed
settingsCollection.update('theme', (draft) => {
  draft.value = 'light'
})
```

## Side Effect Handlers

You can add handlers for side effects (analytics, logging):

```tsx
const settingsCollection = createCollection(
  localStorageCollectionOptions({
    id: 'settings',
    storageKey: 'app-settings',
    getKey: (item) => item.id,

    onUpdate: async ({ transaction }) => {
      // Side effect: track setting changes
      analytics.track('setting_changed', {
        setting: transaction.mutations[0].key,
        newValue: transaction.mutations[0].modified.value,
      })
    },
  }),
)
```

## With Manual Transactions

Local collections require `acceptMutations` in manual transactions:

```tsx
const tx = createTransaction({
  autoCommit: false,
  mutationFn: async ({ transaction }) => {
    // For server collections: call API
    await api.save(...)

    // For local collections: accept mutations
    settingsCollection.utils.acceptMutations(transaction)
  },
})

tx.mutate(() => {
  settingsCollection.update('theme', (d) => { d.value = 'dark' })
})

await tx.commit()
```

## Mixing Local and Server Collections

Same transaction can modify both:

```tsx
const tx = createTransaction({
  autoCommit: false,
  mutationFn: async ({ transaction }) => {
    // Server collection mutations
    const serverMutations = transaction.mutations.filter(
      (m) => m.collection !== localSettings,
    )
    if (serverMutations.length > 0) {
      await api.save(serverMutations)
    }

    // Local collection mutations
    localSettings.utils.acceptMutations(transaction)
  },
})

tx.mutate(() => {
  // Server
  userProfile.update('user-1', (d) => {
    d.name = 'New Name'
  })
  // Local
  localSettings.update('theme', (d) => {
    d.value = 'dark'
  })
})

await tx.commit()
```

## Cross-Tab Sync (LocalStorage)

LocalStorageCollection automatically syncs across tabs:

```tsx
// Tab 1
settingsCollection.update('theme', (d) => {
  d.value = 'dark'
})

// Tab 2 - automatically receives the update
// Live queries update reactively
```

## Storage Limits

localStorage has ~5MB limit per origin. For larger data:

- Consider IndexedDB (via RxDBCollection or custom)
- Split into multiple collections
- Store references, not full data

## Use Cases

| Collection   | Use Case                                  |
| ------------ | ----------------------------------------- |
| LocalOnly    | Modal state, form drafts, temp selections |
| LocalStorage | User preferences, theme, recently viewed  |

## Schema Validation

Both support schema validation:

```tsx
const settingsSchema = z.object({
  id: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
  updatedAt: z.date().default(() => new Date()),
})

const settingsCollection = createCollection(
  localStorageCollectionOptions({
    id: 'settings',
    storageKey: 'app-settings',
    getKey: (item) => item.id,
    schema: settingsSchema,
  }),
)
```

## Clearing Data

```tsx
// Delete all items
const items = settingsCollection.toArray
items.forEach((item) => settingsCollection.delete(item.id))

// Or directly clear localStorage (LocalStorageCollection)
localStorage.removeItem('app-settings')
```
