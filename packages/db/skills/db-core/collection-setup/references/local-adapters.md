# Local Adapters Reference

Both adapters are included in the core package.

## Install

```bash
pnpm add @tanstack/react-db
```

---

## localOnlyCollectionOptions

In-memory only. No persistence. No cross-tab sync.

### Required Config

```typescript
import {
  createCollection,
  localOnlyCollectionOptions,
} from '@tanstack/react-db'

const collection = createCollection(
  localOnlyCollectionOptions({
    id: 'ui-state',
    getKey: (item) => item.id,
  }),
)
```

- `id` -- unique collection identifier
- `getKey` -- extracts unique key from each item

### Optional Config

| Option        | Default | Description                            |
| ------------- | ------- | -------------------------------------- |
| `schema`      | (none)  | StandardSchema validator               |
| `initialData` | (none)  | Array of items to populate on creation |
| `onInsert`    | (none)  | Handler before confirming inserts      |
| `onUpdate`    | (none)  | Handler before confirming updates      |
| `onDelete`    | (none)  | Handler before confirming deletes      |

### Direct Mutations

```typescript
collection.insert({ id: 'theme', mode: 'dark' })
collection.update('theme', (draft) => {
  draft.mode = 'light'
})
collection.delete('theme')
```

### initialData

```typescript
localOnlyCollectionOptions({
  id: 'ui-state',
  getKey: (item) => item.id,
  initialData: [
    { id: 'sidebar', isOpen: false },
    { id: 'theme', mode: 'light' },
  ],
})
```

### acceptMutations in Manual Transactions

When using `createTransaction`, call `collection.utils.acceptMutations(transaction)` in `mutationFn`:

```typescript
import { createTransaction } from '@tanstack/react-db'

const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Handle server mutations first, then:
    localData.utils.acceptMutations(transaction)
  },
})
tx.mutate(() => {
  localData.insert({ id: 'draft-1', data: '...' })
})
await tx.commit()
```

---

## localStorageCollectionOptions

Persists to `localStorage`. Cross-tab sync via storage events. Survives reloads.

### Required Config

```typescript
import {
  createCollection,
  localStorageCollectionOptions,
} from '@tanstack/react-db'

const collection = createCollection(
  localStorageCollectionOptions({
    id: 'user-preferences',
    storageKey: 'app-user-prefs',
    getKey: (item) => item.id,
  }),
)
```

- `id` -- unique collection identifier
- `storageKey` -- localStorage key for all collection data
- `getKey` -- extracts unique key from each item

### Optional Config

| Option            | Default        | Description                                                          |
| ----------------- | -------------- | -------------------------------------------------------------------- |
| `schema`          | (none)         | StandardSchema validator                                             |
| `storage`         | `localStorage` | Custom storage (`sessionStorage` or any localStorage-compatible API) |
| `storageEventApi` | `window`       | Event API for cross-tab sync                                         |
| `onInsert`        | (none)         | Handler on insert                                                    |
| `onUpdate`        | (none)         | Handler on update                                                    |
| `onDelete`        | (none)         | Handler on delete                                                    |

### Using sessionStorage

```typescript
localStorageCollectionOptions({
  id: 'session-data',
  storageKey: 'session-key',
  storage: sessionStorage,
  getKey: (item) => item.id,
})
```

### Custom Storage Backend

Provide any object with `getItem`, `setItem`, `removeItem`:

```typescript
const encryptedStorage = {
  getItem: (key) => {
    const v = localStorage.getItem(key)
    return v ? decrypt(v) : null
  },
  setItem: (key, value) => localStorage.setItem(key, encrypt(value)),
  removeItem: (key) => localStorage.removeItem(key),
}
localStorageCollectionOptions({
  id: 'secure',
  storageKey: 'enc-key',
  storage: encryptedStorage,
  getKey: (i) => i.id,
})
```

### acceptMutations

Same as LocalOnly -- call `collection.utils.acceptMutations(transaction)` in manual transactions.

---

## Comparison

| Feature         | LocalOnly        | LocalStorage |
| --------------- | ---------------- | ------------ |
| Persistence     | None (in-memory) | localStorage |
| Cross-tab sync  | No               | Yes          |
| Survives reload | No               | Yes          |
| Performance     | Fastest          | Fast         |
| Size limits     | Memory           | ~5-10MB      |

## Complete Example

```typescript
import {
  createCollection,
  localOnlyCollectionOptions,
  localStorageCollectionOptions,
} from '@tanstack/react-db'
import { z } from 'zod'

// In-memory UI state
const modalState = createCollection(
  localOnlyCollectionOptions({
    id: 'modal-state',
    getKey: (item) => item.id,
    initialData: [
      { id: 'confirm-delete', isOpen: false },
      { id: 'settings', isOpen: false },
    ],
  }),
)

// Persistent user prefs
const userPrefs = createCollection(
  localStorageCollectionOptions({
    id: 'user-preferences',
    storageKey: 'app-user-prefs',
    getKey: (item) => item.id,
    schema: z.object({
      id: z.string(),
      theme: z.enum(['light', 'dark', 'auto']),
      language: z.string(),
      notifications: z.boolean(),
    }),
  }),
)

modalState.update('settings', (draft) => {
  draft.isOpen = true
})
userPrefs.insert({
  id: 'current-user',
  theme: 'dark',
  language: 'en',
  notifications: true,
})
```
