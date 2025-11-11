---
title: LocalStorage Collection
---

# LocalStorage Collection

LocalStorage collections store small amounts of local-only state that persists across browser sessions and syncs across browser tabs in real-time.

## Overview

The `localStorageCollectionOptions` allows you to create collections that:
- Persist data to localStorage (or sessionStorage)
- Automatically sync across browser tabs using storage events
- Support optimistic updates with automatic rollback on errors
- Store all data under a single localStorage key
- Work with any storage API that matches the localStorage interface

## Installation

LocalStorage collections are included in the core TanStack DB package:

```bash
npm install @tanstack/react-db
```

## Basic Usage

```typescript
import { createCollection } from '@tanstack/react-db'
import { localStorageCollectionOptions } from '@tanstack/react-db'

const userPreferencesCollection = createCollection(
  localStorageCollectionOptions({
    id: 'user-preferences',
    storageKey: 'app-user-prefs',
    getKey: (item) => item.id,
  })
)
```

### Direct Local Mutations

**Important:** LocalStorage collections work differently than server-synced collections. With LocalStorage collections, you **directly mutate state** by calling methods like `collection.insert()`, `collection.update()`, and `collection.delete()` — that's all you need to do. The changes are immediately applied to your local data and automatically persisted to localStorage.

This is different from collections that sync with a server (like `queryCollectionOptions`), where mutation handlers send data to a backend. With LocalStorage collections, everything stays local:

```typescript
// Just call the methods directly - automatically persisted to localStorage
userPreferencesCollection.insert({ id: 'theme', mode: 'dark' })
userPreferencesCollection.update('theme', (draft) => { draft.mode = 'light' })
userPreferencesCollection.delete('theme')
```

## Configuration Options

The `localStorageCollectionOptions` function accepts the following options:

### Required Options

- `id`: Unique identifier for the collection
- `storageKey`: The localStorage key where all collection data is stored
- `getKey`: Function to extract the unique key from an item

### Optional Options

- `schema`: [Standard Schema](https://standardschema.dev) compatible schema (e.g., Zod, Effect) for client-side validation
- `storage`: Custom storage implementation (defaults to `localStorage`). Can be `sessionStorage` or any object with the localStorage API
- `storageEventApi`: Event API for subscribing to storage events (defaults to `window`). Enables custom cross-tab, cross-window, or cross-process synchronization
- `onInsert`: Optional handler function called when items are inserted
- `onUpdate`: Optional handler function called when items are updated
- `onDelete`: Optional handler function called when items are deleted

## Cross-Tab Synchronization

LocalStorage collections automatically sync across browser tabs in real-time:

```typescript
const settingsCollection = createCollection(
  localStorageCollectionOptions({
    id: 'settings',
    storageKey: 'app-settings',
    getKey: (item) => item.id,
  })
)

// Changes in one tab are automatically reflected in all other tabs
// This works automatically via storage events
```

## Using SessionStorage

You can use `sessionStorage` instead of `localStorage` for session-only persistence:

```typescript
const sessionCollection = createCollection(
  localStorageCollectionOptions({
    id: 'session-data',
    storageKey: 'session-key',
    storage: sessionStorage, // Use sessionStorage instead
    getKey: (item) => item.id,
  })
)
```

## Custom Storage Backend

Provide any storage implementation that matches the localStorage API:

```typescript
// Example: Custom storage wrapper with encryption
const encryptedStorage = {
  getItem(key: string) {
    const encrypted = localStorage.getItem(key)
    return encrypted ? decrypt(encrypted) : null
  },
  setItem(key: string, value: string) {
    localStorage.setItem(key, encrypt(value))
  },
  removeItem(key: string) {
    localStorage.removeItem(key)
  },
}

const secureCollection = createCollection(
  localStorageCollectionOptions({
    id: 'secure-data',
    storageKey: 'encrypted-key',
    storage: encryptedStorage,
    getKey: (item) => item.id,
  })
)
```

### Cross-Tab Sync with Custom Storage

The `storageEventApi` option (defaults to `window`) allows the collection to subscribe to storage events for cross-tab synchronization. A custom storage implementation can provide this API to enable custom cross-tab, cross-window, or cross-process sync:

```typescript
// Example: Custom storage event API for cross-process sync
const customStorageEventApi = {
  addEventListener(event: string, handler: (e: StorageEvent) => void) {
    // Custom event subscription logic
    // Could be IPC, WebSocket, or any other mechanism
    myCustomEventBus.on('storage-change', handler)
  },
  removeEventListener(event: string, handler: (e: StorageEvent) => void) {
    myCustomEventBus.off('storage-change', handler)
  },
}

const syncedCollection = createCollection(
  localStorageCollectionOptions({
    id: 'synced-data',
    storageKey: 'data-key',
    storage: customStorage,
    storageEventApi: customStorageEventApi, // Custom event API
    getKey: (item) => item.id,
  })
)
```

This enables synchronization across different contexts beyond just browser tabs, such as:
- Cross-process communication in Electron apps
- WebSocket-based sync across multiple browser windows
- Custom IPC mechanisms in desktop applications

## Mutation Handlers

Mutation handlers are **completely optional**. Data will persist to localStorage whether or not you provide handlers:

```typescript
const preferencesCollection = createCollection(
  localStorageCollectionOptions({
    id: 'preferences',
    storageKey: 'user-prefs',
    getKey: (item) => item.id,
    // Optional: Add custom logic when preferences are updated
    onUpdate: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      console.log('Preference updated:', modified)
      // Maybe send analytics or trigger other side effects
    },
  })
)
```

## Manual Transactions

When using LocalStorage collections with manual transactions (created via `createTransaction`), you must call `utils.acceptMutations()` to persist the changes:

```typescript
import { createTransaction } from '@tanstack/react-db'

const localData = createCollection(
  localStorageCollectionOptions({
    id: 'form-draft',
    storageKey: 'draft-data',
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

    // After server mutations succeed, persist local collection mutations
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

## Complete Example

```typescript
import { createCollection } from '@tanstack/react-db'
import { localStorageCollectionOptions } from '@tanstack/react-db'
import { useLiveQuery } from '@tanstack/react-db'
import { z } from 'zod'

// Define schema
const userPrefsSchema = z.object({
  id: z.string(),
  theme: z.enum(['light', 'dark', 'auto']),
  language: z.string(),
  notifications: z.boolean(),
})

type UserPrefs = z.infer<typeof userPrefsSchema>

// Create collection
export const userPreferencesCollection = createCollection(
  localStorageCollectionOptions({
    id: 'user-preferences',
    storageKey: 'app-user-prefs',
    getKey: (item) => item.id,
    schema: userPrefsSchema,
  })
)

// Use in component
function SettingsPanel() {
  const { data: prefs } = useLiveQuery((q) =>
    q.from({ pref: userPreferencesCollection })
      .where(({ pref }) => pref.id === 'current-user')
  )

  const currentPrefs = prefs[0]

  const updateTheme = (theme: 'light' | 'dark' | 'auto') => {
    if (currentPrefs) {
      userPreferencesCollection.update(currentPrefs.id, (draft) => {
        draft.theme = theme
      })
    } else {
      userPreferencesCollection.insert({
        id: 'current-user',
        theme,
        language: 'en',
        notifications: true,
      })
    }
  }

  return (
    <div>
      <h2>Theme: {currentPrefs?.theme}</h2>
      <button onClick={() => updateTheme('dark')}>Dark Mode</button>
      <button onClick={() => updateTheme('light')}>Light Mode</button>
    </div>
  )
}
```

## Use Cases

LocalStorage collections are perfect for:
- User preferences and settings
- UI state that should persist across sessions
- Form drafts
- Recently viewed items
- User-specific configurations
- Small amounts of cached data

## Learn More

- [Optimistic Mutations](../guides/mutations.md)
- [Live Queries](../guides/live-queries.md)
- [LocalOnly Collection](./local-only-collection.md)
