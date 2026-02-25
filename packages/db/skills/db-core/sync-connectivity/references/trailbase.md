# TrailBase Adapter Reference

Package: `@tanstack/trailbase-db-collection`

## Setup

```typescript
import { createCollection } from '@tanstack/db'
import { trailBaseCollectionOptions } from '@tanstack/trailbase-db-collection'
import { Client } from 'trailbase'

const client = new Client('http://localhost:4000')
const recordApi = client.records('todos')

const todosCollection = createCollection(
  trailBaseCollectionOptions({
    recordApi,
    getKey: (todo) => todo.id,
    parse: {
      // Convert from TrailBase record format to app format
      created_at: (val) => new Date(val),
    },
    serialize: {
      // Convert from app format to TrailBase record format
      created_at: (val) => val.toISOString(),
    },
  }),
)
```

## Configuration

```typescript
trailBaseCollectionOptions({
  // Required
  recordApi: RecordApi<TRecord>,
  getKey: (item: TItem) => string | number,
  parse: Conversions<TRecord, TItem>, // record → app type
  serialize: Conversions<TItem, TRecord>, // app type → record

  // Optional
  id: string,
})
```

## Type Conversions (parse / serialize)

TrailBase uses a bidirectional conversion system. `parse` converts
from the server record type to the app type, `serialize` does the
reverse:

```typescript
type Todo = {
  id: string
  text: string
  completed: boolean
  created_at: Date // app uses Date
}

type TodoRecord = {
  id: string
  text: string
  completed: boolean
  created_at: string // server sends ISO string
}

trailBaseCollectionOptions<Todo, TodoRecord>({
  recordApi,
  getKey: (todo) => todo.id,
  parse: {
    // Only need converters for keys where types differ
    created_at: (val: string) => new Date(val),
  },
  serialize: {
    created_at: (val: Date) => val.toISOString(),
  },
})
```

**Key rule**: You only need to provide converters for properties where
`TRecord[K]` and `TItem[K]` differ. Properties with matching types
are passed through unchanged. Properties with differing types are
**required** — TypeScript enforces this.

## How Sync Works

1. **Subscribe first**: Opens an event stream via
   `recordApi.subscribe('*')` before fetching
2. **Initial fetch**: Pages through all records using
   `recordApi.list()` with cursor-based pagination (256 per page)
3. **Live events**: Processes Insert, Update, Delete, and Error events
   from the stream
4. **ID tracking**: Maintains a `seenIds` store for optimistic state
   resolution (entries expire after 5 minutes)

## How Mutations Work

Mutations use the TrailBase Record API:

- **Insert**: `recordApi.createBulk()` — then awaits the IDs
  appearing in the event stream before resolving
- **Update**: `recordApi.update(key, changes)` — serializes partial
  changes, awaits confirmation
- **Delete**: `recordApi.delete(key)` — awaits confirmation

All mutations await their IDs in the event stream before resolving.
This ensures the optimistic overlay is only removed after the local
state has been updated by the subscription.

## Utils

```typescript
// Cancel the event stream reader
collection.utils.cancel()
```

## Key Differences from Other Adapters

- **Bidirectional type conversions**: `parse` and `serialize` provide
  type-safe conversion between server and app representations
- **Event stream-based**: Uses TrailBase's real-time event streaming
  (ReadableStream) instead of polling or shape-based sync
- **Automatic optimistic confirmation**: Mutations wait for their IDs
  to appear in the event stream (default 120s timeout) — throws
  `TimeoutWaitingForIdsError` if not seen
- **ID cleanup**: Tracked IDs expire after 5 minutes to prevent
  memory leaks, with cleanup running every 2 minutes
- **Cursor-based pagination**: Initial sync uses cursor-based
  pagination for efficient loading of large datasets
