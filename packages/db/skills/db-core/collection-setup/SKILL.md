---
name: db-core/collection-setup
description: >
  Creating typed collections with createCollection. Adapter selection:
  queryCollectionOptions (REST/TanStack Query), electricCollectionOptions
  (ElectricSQL real-time sync), powerSyncCollectionOptions (PowerSync SQLite),
  rxdbCollectionOptions (RxDB), trailbaseCollectionOptions (TrailBase),
  localOnlyCollectionOptions, localStorageCollectionOptions. CollectionConfig
  options: getKey, schema, sync, gcTime, autoIndex (default off), defaultIndexType,
  syncMode (eager/on-demand, plus progressive for Electric). StandardSchema validation
  with Zod/Valibot/ArkType. Collection lifecycle (idle/loading/ready/error).
  Adapter-specific sync patterns including Electric txid tracking, Query direct
  writes, and PowerSync query-driven sync with onLoad/onLoadSubset hooks.
type: sub-skill
library: db
library_version: '0.6.0'
sources:
  - 'TanStack/db:docs/overview.md'
  - 'TanStack/db:docs/guides/schemas.md'
  - 'TanStack/db:docs/collections/query-collection.md'
  - 'TanStack/db:docs/collections/electric-collection.md'
  - 'TanStack/db:docs/collections/powersync-collection.md'
  - 'TanStack/db:docs/collections/rxdb-collection.md'
  - 'TanStack/db:docs/collections/trailbase-collection.md'
  - 'TanStack/db:packages/db/src/collection/index.ts'
---

This skill builds on db-core. Read it first for the overall mental model.

# Collection Setup & Schema

## Setup

```ts
import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { QueryClient } from '@tanstack/query-core'
import { z } from 'zod'

const queryClient = new QueryClient()

const todoSchema = z.object({
  id: z.number(),
  text: z.string(),
  completed: z.boolean().default(false),
  created_at: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
})

const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => {
      const res = await fetch('/api/todos')
      return res.json()
    },
    queryClient,
    getKey: (item) => item.id,
    schema: todoSchema,
    onInsert: async ({ transaction }) => {
      await api.todos.create(transaction.mutations[0].modified)
      await todoCollection.utils.refetch()
    },
    onUpdate: async ({ transaction }) => {
      const mut = transaction.mutations[0]
      await api.todos.update(mut.key, mut.changes)
      await todoCollection.utils.refetch()
    },
    onDelete: async ({ transaction }) => {
      await api.todos.delete(transaction.mutations[0].key)
      await todoCollection.utils.refetch()
    },
  }),
)
```

## Choosing an Adapter

| Backend                          | Adapter                         | Package                             |
| -------------------------------- | ------------------------------- | ----------------------------------- |
| REST API / TanStack Query        | `queryCollectionOptions`        | `@tanstack/query-db-collection`     |
| ElectricSQL (real-time Postgres) | `electricCollectionOptions`     | `@tanstack/electric-db-collection`  |
| PowerSync (SQLite offline)       | `powerSyncCollectionOptions`    | `@tanstack/powersync-db-collection` |
| RxDB (reactive database)         | `rxdbCollectionOptions`         | `@tanstack/rxdb-db-collection`      |
| TrailBase (event streaming)      | `trailbaseCollectionOptions`    | `@tanstack/trailbase-db-collection` |
| No backend (UI state)            | `localOnlyCollectionOptions`    | `@tanstack/db`                      |
| Browser localStorage             | `localStorageCollectionOptions` | `@tanstack/db`                      |

If the user specifies a backend (e.g. Electric, PowerSync), use that adapter directly. Only use `localOnlyCollectionOptions` when there is no backend yet — the collection API is uniform, so swapping to a real adapter later only changes the options creator.

## Sync Modes

```ts
queryCollectionOptions({
  syncMode: 'eager', // default — loads all data upfront
  // syncMode: "on-demand", // loads only what live queries request
  // syncMode: "progressive", // (Electric only) query subset first, full sync in background
})
```

| Mode          | Best for                                                       | Data size |
| ------------- | -------------------------------------------------------------- | --------- |
| `eager`       | Mostly-static datasets                                         | <10k rows |
| `on-demand`   | Search, catalogs, large tables                                 | >50k rows |
| `progressive` | Collaborative apps needing instant first paint (Electric only) | Any       |

## Indexing

Indexing is opt-in. The `autoIndex` option defaults to `"off"`. To enable automatic indexing, set `autoIndex: "eager"` and provide a `defaultIndexType`:

```ts
import { BasicIndex } from '@tanstack/db'

createCollection(
  queryCollectionOptions({
    autoIndex: 'eager',
    defaultIndexType: BasicIndex,
    // ...
  }),
)
```

Without `defaultIndexType`, setting `autoIndex: "eager"` throws a `CollectionConfigurationError`. You can also create indexes manually with `collection.createIndex()` and remove them with `collection.removeIndex()`.

## Core Patterns

### Local-only collection for prototyping

```ts
import {
  createCollection,
  localOnlyCollectionOptions,
} from '@tanstack/react-db'

const todoCollection = createCollection(
  localOnlyCollectionOptions({
    getKey: (item) => item.id,
    initialData: [{ id: 1, text: 'Learn TanStack DB', completed: false }],
  }),
)
```

### Schema with type transformations

```ts
const schema = z.object({
  id: z.number(),
  title: z.string(),
  due_date: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
  priority: z.number().default(0),
})
```

Use `z.union([z.string(), z.date()])` for transformed fields — this ensures `TInput` is a superset of `TOutput` so that `update()` works correctly with the draft proxy.

### ElectricSQL with txid tracking

Always use a schema with Electric — without one, the collection types as `Record<string, unknown>`.

```ts
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { z } from 'zod'

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  created_at: z.coerce.date(),
})

const todoCollection = createCollection(
  electricCollectionOptions({
    schema: todoSchema,
    shapeOptions: { url: '/api/electric/todos' },
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const res = await api.todos.create(transaction.mutations[0].modified)
      return { txid: res.txid }
    },
  }),
)
```

The returned `txid` tells the collection to hold optimistic state until Electric streams back that transaction. See the [Electric adapter reference](references/electric-adapter.md) for the full dual-path pattern (schema + parser).

## Common Mistakes

### CRITICAL queryFn returning empty array deletes all data

Wrong:

```ts
queryCollectionOptions({
  queryFn: async () => {
    const res = await fetch('/api/todos?status=active')
    return res.json() // returns [] when no active todos — deletes everything
  },
})
```

Correct:

```ts
queryCollectionOptions({
  queryFn: async () => {
    const res = await fetch('/api/todos') // fetch complete state
    return res.json()
  },
  // Use on-demand mode + live query where() for filtering
  syncMode: 'on-demand',
})
```

`queryFn` result is treated as complete server state. Returning `[]` means "server has no items", deleting all existing collection data.

Source: docs/collections/query-collection.md

### CRITICAL Not using the correct adapter for your backend

Wrong:

```ts
const todoCollection = createCollection(
  localOnlyCollectionOptions({
    getKey: (item) => item.id,
  }),
)
// Manually fetching and inserting...
```

Correct:

```ts
const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then((r) => r.json()),
    queryClient,
    getKey: (item) => item.id,
  }),
)
```

Each backend has a dedicated adapter that handles sync, mutation handlers, and utilities. Using `localOnlyCollectionOptions` or bare `createCollection` for a real backend bypasses all of this.

Source: docs/overview.md

### CRITICAL Electric txid queried outside mutation transaction

Wrong:

```ts
// Backend handler
app.post('/api/todos', async (req, res) => {
  const txid = await generateTxId(sql) // WRONG: separate transaction
  await sql`INSERT INTO todos ${sql(req.body)}`
  res.json({ txid })
})
```

Correct:

```ts
app.post('/api/todos', async (req, res) => {
  let txid
  await sql.begin(async (tx) => {
    txid = await generateTxId(tx) // CORRECT: same transaction
    await tx`INSERT INTO todos ${tx(req.body)}`
  })
  res.json({ txid })
})
```

`pg_current_xact_id()` must be queried inside the same SQL transaction as the mutation. Otherwise the txid doesn't match and `awaitTxId` times out (default 5 seconds).

Source: docs/collections/electric-collection.md

### CRITICAL queryFn returning partial data without merging

Wrong:

```ts
queryCollectionOptions({
  queryFn: async () => {
    const newItems = await fetch('/api/todos?since=' + lastSync)
    return newItems.json() // only new items — everything else deleted
  },
})
```

Correct:

```ts
queryCollectionOptions({
  queryFn: async (ctx) => {
    const existing = ctx.queryClient.getQueryData(['todos']) || []
    const newItems = await fetch('/api/todos?since=' + lastSync).then((r) =>
      r.json(),
    )
    return [...existing, ...newItems]
  },
})
```

`queryFn` result replaces all collection data. For incremental fetches, merge with existing data.

Source: docs/collections/query-collection.md

### HIGH Using async schema validation

Wrong:

```ts
const schema = z.object({
  email: z.string().refine(async (val) => {
    const exists = await checkEmail(val)
    return !exists
  }),
})
```

Correct:

```ts
const schema = z.object({
  email: z.string().email(),
})
// Do async validation in the mutation handler instead
```

Schema validation must be synchronous. Async validation throws `SchemaMustBeSynchronousError` at mutation time.

Source: packages/db/src/collection/mutations.ts:101

### HIGH getKey returning undefined for some items

Wrong:

```ts
createCollection(
  queryCollectionOptions({
    getKey: (item) => item.metadata.id, // undefined if metadata missing
  }),
)
```

Correct:

```ts
createCollection(
  queryCollectionOptions({
    getKey: (item) => item.id, // always present
  }),
)
```

`getKey` must return a defined value for every item. Throws `UndefinedKeyError` otherwise.

Source: packages/db/src/collection/mutations.ts:148

### HIGH TInput not a superset of TOutput with schema transforms

Wrong:

```ts
const schema = z.object({
  created_at: z.string().transform((val) => new Date(val)),
})
// update() fails — draft.created_at is Date but schema only accepts string
```

Correct:

```ts
const schema = z.object({
  created_at: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
})
```

When a schema transforms types, `TInput` must accept both the pre-transform and post-transform types for `update()` to work with the draft proxy.

Source: docs/guides/schemas.md

### HIGH React Native missing crypto.randomUUID polyfill

TanStack DB uses `crypto.randomUUID()` internally. React Native doesn't provide this. Install `react-native-random-uuid` and import it at your app entry point.

Source: docs/overview.md

### MEDIUM Providing both explicit type parameter and schema

Wrong:

```ts
createCollection<Todo>(queryCollectionOptions({ schema: todoSchema, ... }))
```

Correct:

```ts
createCollection(queryCollectionOptions({ schema: todoSchema, ... }))
```

When a schema is provided, the collection infers types from it. An explicit generic creates conflicting type constraints.

Source: docs/overview.md

### MEDIUM Direct writes overridden by next query sync

Wrong:

```ts
todoCollection.utils.writeInsert(newItem)
// Next queryFn execution replaces all data, losing the direct write
```

Correct:

```ts
todoCollection.utils.writeInsert(newItem)
// Use staleTime to prevent immediate refetch
// Or return { refetch: false } from mutation handlers
```

Direct writes update the collection immediately, but the next `queryFn` returns complete server state which overwrites them.

Source: docs/collections/query-collection.md

## References

- [TanStack Query adapter](references/query-adapter.md)
- [ElectricSQL adapter](references/electric-adapter.md)
- [PowerSync adapter](references/powersync-adapter.md)
- [RxDB adapter](references/rxdb-adapter.md)
- [TrailBase adapter](references/trailbase-adapter.md)
- [Local adapters (local-only, localStorage)](references/local-adapters.md)
- [Schema validation patterns](references/schema-patterns.md)

See also: db-core/mutations-optimistic/SKILL.md — mutation handlers configured here execute during mutations.

See also: db-core/custom-adapter/SKILL.md — for building your own adapter.
