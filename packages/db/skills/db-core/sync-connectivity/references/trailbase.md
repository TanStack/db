# TrailBase Adapter Reference

Package: `@tanstack/trailbase-db-collection`

## Setup

```typescript
import { createCollection } from '@tanstack/react-db'
import { trailBaseCollectionOptions } from '@tanstack/trailbase-db-collection'
import { initClient } from 'trailbase'

const trailBaseClient = initClient('http://localhost:4000')

const todosCollection = createCollection(
  trailBaseCollectionOptions({
    id: 'todos',
    recordApi: trailBaseClient.records('todos'),
    getKey: (item) => item.id,
    parse: {
      created_at: (ts) => new Date(ts * 1000),
      updated_at: (ts) => new Date(ts * 1000),
    },
    serialize: {
      created_at: (date) => Math.floor(date.valueOf() / 1000),
      updated_at: (date) => Math.floor(date.valueOf() / 1000),
    },
  }),
)
```

Source: examples/react/todo/src/lib/collections.ts:131-146

## Configuration

```typescript
trailBaseCollectionOptions({
  // Required
  id: string,
  recordApi: RecordApi<TRecord>,
  getKey: (item: TItem) => string | number,
  parse: Conversions<TRecord, TItem>,      // record → app type
  serialize: Conversions<TItem, TRecord>,   // app type → record

  // Optional
  schema: StandardSchemaV1,
})
```

Source: docs/collections/trailbase-collection.md — Configuration Options

## Type Conversions (parse / serialize)

TrailBase uses a bidirectional conversion system. `parse` converts
from the server record type to the app type, `serialize` does the
reverse. TrailBase stores timestamps as Unix seconds (numbers):

```typescript
type Todo = {
  id: string
  text: string
  completed: boolean
  created_at: Date       // app uses Date
  updated_at: Date
}

type TodoRecord = {
  id: number             // TrailBase uses numeric IDs
  text: string
  completed: boolean
  created_at: number     // Unix timestamp (seconds)
  updated_at: number
}

trailBaseCollectionOptions<Todo, TodoRecord>({
  id: 'todos',
  recordApi: trailBaseClient.records('todos'),
  getKey: (item) => item.id,
  parse: {
    created_at: (ts) => new Date(ts * 1000),
    updated_at: (ts) => new Date(ts * 1000),
  },
  serialize: {
    created_at: (date) => Math.floor(date.valueOf() / 1000),
    updated_at: (date) => Math.floor(date.valueOf() / 1000),
  },
})
```

**Key rule**: You only need to provide converters for properties where
`TRecord[K]` and `TItem[K]` differ. Properties with matching types
are passed through unchanged. Properties with differing types are
**required** — TypeScript enforces this.

Source: docs/collections/trailbase-collection.md — Data Transformation,
examples/react/todo/src/lib/collections.ts:136-145

## How Sync Works

1. **Subscribe first**: Opens an event stream via
   `recordApi.subscribe('*')` before fetching
2. **Initial fetch**: Pages through all records using
   `recordApi.list()` with cursor-based pagination (256 per page)
3. **Live events**: Processes Insert, Update, Delete, and Error events
   from the ReadableStream
4. **ID tracking**: Maintains a `seenIds` store for optimistic state
   resolution (entries expire after 5 minutes)

Source: packages/trailbase-db-collection/src/trailbase.ts:167-287

## How Mutations Work

Mutations use the TrailBase Record API. The adapter handles all
persistence automatically — you do NOT provide `onInsert`, `onUpdate`,
or `onDelete` handlers:

- **Insert**: `recordApi.createBulk(items)` — then awaits the IDs
  appearing in the event stream before resolving
- **Update**: `recordApi.update(key, serializedChanges)` — awaits
  confirmation via event stream
- **Delete**: `recordApi.delete(key)` — awaits confirmation via
  event stream

All mutations await their IDs in the event stream before resolving
(default timeout: 120s). This ensures the optimistic overlay is only
removed after the local state has been updated by the subscription.

Source: packages/trailbase-db-collection/src/trailbase.ts:296-355

## Utils

```typescript
// Cancel the event stream reader
collection.utils.cancel()
```

Source: packages/trailbase-db-collection/src/trailbase.ts:106-108

## Real-time Subscriptions

TrailBase supports real-time subscriptions when `enable_subscriptions`
is enabled on the server. The adapter subscribes automatically:

```typescript
const todosCollection = createCollection(
  trailBaseCollectionOptions({
    id: 'todos',
    recordApi: trailBaseClient.records('todos'),
    getKey: (item) => item.id,
    parse: {},
    serialize: {},
  }),
)
// Changes from other clients automatically update in real-time
```

Source: docs/collections/trailbase-collection.md — Real-time Subscriptions

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
- **No user-provided mutation handlers**: The adapter handles all
  persistence via the Record API automatically
