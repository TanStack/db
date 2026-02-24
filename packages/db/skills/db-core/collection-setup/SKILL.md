---
name: db-core/collection-setup
description: >
  Creating and configuring typed collections. Covers createCollection,
  queryCollectionOptions, electricCollectionOptions, powerSyncCollectionOptions,
  rxdbCollectionOptions, trailBaseCollectionOptions, localOnlyCollectionOptions,
  localStorageCollectionOptions. CollectionConfig (id, getKey, schema, sync,
  compare, autoIndex, startSync, gcTime, utils). StandardSchema integration
  with Zod, Valibot, ArkType. Schema validation, TInput vs TOutput,
  type transformations. Collection lifecycle and status tracking.
type: sub-skill
library: db
library_version: '0.5.29'
sources:
  - 'TanStack/db:docs/overview.md'
  - 'TanStack/db:docs/collections/query-collection.md'
  - 'TanStack/db:docs/collections/electric-collection.md'
  - 'TanStack/db:docs/guides/schemas.md'
  - 'TanStack/db:packages/db/src/collection/collection.ts'
  - 'TanStack/db:packages/db/src/collection/mutations.ts'
---

# Collection Setup & Schema

## Setup

Every collection needs a data source and a key extractor. The adapter you
choose depends on your backend:

```typescript
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => {
      const res = await fetch('/api/todos')
      return res.json()
    },
    getKey: (todo) => todo.id,
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      await fetch(`/api/todos/${original.id}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
    },
  }),
)
```

## Core Patterns

### Choosing the right collection adapter

| Backend                          | Package                             | Options creator                   |
| -------------------------------- | ----------------------------------- | --------------------------------- |
| REST API / TanStack Query        | `@tanstack/query-db-collection`     | `queryCollectionOptions()`        |
| ElectricSQL (real-time Postgres) | `@tanstack/electric-db-collection`  | `electricCollectionOptions()`     |
| PowerSync (SQLite sync)          | `@tanstack/powersync-db-collection` | `powerSyncCollectionOptions()`    |
| RxDB (local-first)               | `@tanstack/rxdb-db-collection`      | `rxdbCollectionOptions()`         |
| TrailBase (self-hosted)          | `@tanstack/trailbase-db-collection` | `trailBaseCollectionOptions()`    |
| In-memory only                   | `@tanstack/db`                      | `localOnlyCollectionOptions()`    |
| localStorage (cross-tab)         | `@tanstack/db`                      | `localStorageCollectionOptions()` |

Each adapter returns a config object spread into `createCollection`. Always
use the adapter matching your backend — it handles sync, handlers, and
utilities correctly.

### Prototyping with localOnly then swapping to a real backend

Start with `localOnlyCollectionOptions` and swap to a real adapter later.
The collection API is uniform — queries and components don't change:

```typescript
import { createCollection, localOnlyCollectionOptions } from '@tanstack/db'

// Prototype
const todosCollection = createCollection(
  localOnlyCollectionOptions({
    getKey: (todo) => todo.id,
    initialData: [{ id: '1', text: 'Buy milk', completed: false }],
  }),
)

// Later, swap to real backend — no query/component changes needed:
// const todosCollection = createCollection(
//   queryCollectionOptions({ ... })
// )
```

### Adding schema validation with type transformations

Use any StandardSchema-compatible library (Zod, Valibot, ArkType, Effect).
Schemas validate client mutations and can transform types:

```typescript
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { z } from 'zod'

const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  completed: z.boolean().default(false),
  created_at: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
})

const todosCollection = createCollection(
  queryCollectionOptions({
    schema: todoSchema,
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then((r) => r.json()),
    getKey: (todo) => todo.id,
  }),
)
```

Schemas validate only client mutations (insert/update), not server data.

### Persistent cross-tab state with localStorage

```typescript
import { createCollection, localStorageCollectionOptions } from '@tanstack/db'

const settingsCollection = createCollection(
  localStorageCollectionOptions({
    id: 'user-settings',
    storageKey: 'app-settings',
    getKey: (item) => item.key,
  }),
)

// Direct mutations — no handlers needed
settingsCollection.insert({ key: 'theme', value: 'dark' })
```

### Collection lifecycle

Collections transition through statuses:
`idle` → `loading` → `ready` (or `error`) → `cleaned-up`

```typescript
collection.status // 'idle' | 'loading' | 'ready' | 'error' | 'cleaned-up'
collection.isReady() // boolean

// Wait for initial data before proceeding
await collection.preload()
```

## Common Mistakes

### CRITICAL — queryFn returning empty array deletes all collection data

Wrong:

```typescript
queryCollectionOptions({
  queryFn: async () => {
    const res = await fetch('/api/todos')
    if (!res.ok) return [] // "safe" fallback
    return res.json()
  },
})
```

Correct:

```typescript
queryCollectionOptions({
  queryFn: async () => {
    const res = await fetch('/api/todos')
    if (!res.ok) throw new Error(`Failed: ${res.status}`)
    return res.json()
  },
})
```

queryCollectionOptions treats the queryFn result as complete server state.
Returning `[]` means "server has zero items" and deletes everything from
the collection. Throw on errors instead.

Source: docs/collections/query-collection.md — Full State Sync section

### CRITICAL — Not knowing which collection type to use for a given backend

Wrong:

```typescript
import { createCollection } from '@tanstack/db'

const todos = createCollection({
  id: 'todos',
  getKey: (t) => t.id,
  sync: {
    /* manually wiring fetch + polling */
  },
})
```

Correct:

```typescript
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const todos = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: () => fetch('/api/todos').then((r) => r.json()),
    getKey: (t) => t.id,
  }),
)
```

Each backend has a dedicated adapter that handles sync, mutation handlers,
and utilities. Use `queryCollectionOptions` for REST, `electricCollectionOptions`
for ElectricSQL, etc. See the adapter table above.

Source: maintainer interview

### HIGH — Using async schema validation

Wrong:

```typescript
const schema = z.object({
  email: z.string().refine(async (email) => {
    const exists = await checkEmail(email)
    return !exists
  }),
})
```

Correct:

```typescript
const schema = z.object({
  email: z.string().email(),
})
```

Schema validation must be synchronous. Returning a Promise throws
`SchemaMustBeSynchronousError`, but only at mutation time — not at
collection creation. Async validation belongs in your mutation handler.

Source: packages/db/src/collection/mutations.ts:101

### HIGH — getKey returning undefined for some items

Wrong:

```typescript
createCollection(
  queryCollectionOptions({
    getKey: (item) => item.metadata.id,
    // throws UndefinedKeyError when metadata is null
  }),
)
```

Correct:

```typescript
createCollection(
  queryCollectionOptions({
    getKey: (item) => item.id,
  }),
)
```

If `getKey` returns `undefined` for any item, TanStack DB throws
`UndefinedKeyError`. Use a top-level property that exists on every item.

Source: packages/db/src/collection/mutations.ts:148

### HIGH — TInput not a superset of TOutput with schema transforms

Wrong:

```typescript
const schema = z.object({
  created_at: z.string().transform((val) => new Date(val)),
})
// TInput: { created_at: string }
// TOutput: { created_at: Date }
// Updates fail — draft.created_at is a Date, but schema expects string
```

Correct:

```typescript
const schema = z.object({
  created_at: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
})
// TInput: { created_at: string | Date }  ← accepts both
// TOutput: { created_at: Date }
```

When a schema transforms types, the input type for mutations must accept
both the pre-transform and post-transform types. Otherwise updates using
the draft proxy fail because the draft contains the transformed type.

Source: docs/guides/schemas.md

### HIGH — React Native missing crypto.randomUUID polyfill

Wrong:

```typescript
// App.tsx — React Native
import { createCollection } from '@tanstack/db'
// Crashes: crypto.randomUUID is not a function
```

Correct:

```typescript
// App.tsx — React Native entry point
import 'react-native-random-uuid'
import { createCollection } from '@tanstack/db'
```

TanStack DB uses `crypto.randomUUID()` internally. React Native doesn't
provide this API — install and import `react-native-random-uuid` at your
entry point.

Source: docs/overview.md — React Native section

### MEDIUM — Providing both explicit type parameter and schema

Wrong:

```typescript
interface Todo {
  id: string
  text: string
}
const collection = createCollection<Todo>(
  queryCollectionOptions({
    schema: todoSchema, // also infers types
    // conflicting type constraints
  }),
)
```

Correct:

```typescript
const collection = createCollection(
  queryCollectionOptions({
    schema: todoSchema, // types inferred from schema
  }),
)
```

When a schema is provided, the collection infers types from it. Also
passing an explicit generic creates conflicting type constraints. Use
one or the other.

Source: docs/overview.md
