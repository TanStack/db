---
name: tanstack-db-trailbase
description: |
  TrailBaseCollection with TrailBase integration.
  Use for real-time backend sync, event subscriptions, and type-safe APIs.
---

# TrailBaseCollection

TrailBaseCollection integrates TrailBase with TanStack DB, enabling real-time sync with a TrailBase backend. The collection subscribes to server events and automatically keeps the in-memory state synchronized.

## Common Patterns

### Basic Setup

```tsx
import { createCollection } from '@tanstack/react-db'
import { trailBaseCollectionOptions } from '@tanstack/trailbase-db-collection'
import { Client } from 'trailbase'

// Create TrailBase client
const client = new Client('https://your-trailbase-server.com')
const recordApi = client.records('todos')

// Define types
interface Todo {
  id: string
  text: string
  completed: boolean
  created_at: Date
}

// Record type (what TrailBase returns)
interface TodoRecord {
  id: string
  text: string
  completed: boolean
  created_at: string // ISO string from server
}

const todoCollection = createCollection(
  trailBaseCollectionOptions<Todo, TodoRecord>({
    recordApi,
    getKey: (item) => item.id,

    // Convert server records to app types
    parse: {
      created_at: (value: string) => new Date(value),
    },

    // Convert app types to server records
    serialize: {
      created_at: (value: Date) => value.toISOString(),
    },
  }),
)
```

### Type Conversions

TrailBase uses a conversion system for bidirectional type mapping:

```tsx
interface AppType {
  id: string
  isActive: boolean // App uses boolean
  createdAt: Date // App uses Date
  tags: string[] // App uses array
}

interface RecordType {
  id: string
  isActive: number // Server stores 0/1
  createdAt: string // Server stores ISO string
  tags: string // Server stores JSON string
}

const collection = createCollection(
  trailBaseCollectionOptions<AppType, RecordType>({
    recordApi,
    getKey: (item) => item.id,

    // Parse: RecordType -> AppType
    parse: {
      isActive: (v: number) => v > 0,
      createdAt: (v: string) => new Date(v),
      tags: (v: string) => JSON.parse(v),
    },

    // Serialize: AppType -> RecordType
    serialize: {
      isActive: (v: boolean) => (v ? 1 : 0),
      createdAt: (v: Date) => v.toISOString(),
      tags: (v: string[]) => JSON.stringify(v),
    },
  }),
)
```

### Conversion Rules

1. **Required conversions**: Fields where types differ between input and output MUST have converters
2. **Optional conversions**: Fields with identical types can optionally have converters (for normalization, etc.)

```tsx
// TypeScript enforces required conversions
parse: {
  // ❌ Error if missing when types differ
  created_at: (v: string) => new Date(v), // Required: string -> Date

  // ✅ Optional when types match
  text: (v: string) => v.trim(), // Optional: string -> string
},
```

## How It Works

1. **Event Subscription**: On collection creation, subscribes to TrailBase events via `recordApi.subscribe('*')`
2. **Initial Fetch**: Fetches all existing records using pagination
3. **Live Updates**: Server events (Insert/Update/Delete) are parsed and applied to the collection
4. **Mutations**: Insert/update/delete operations call the RecordApi and wait for confirmation via event stream

## Mutation Flow

Mutations wait for the server event before completing:

```tsx
// When you call:
todoCollection.insert({ id: '1', text: 'Hello', completed: false })

// Internally:
// 1. Optimistic update applied immediately
// 2. recordApi.createBulk() sends to server
// 3. awaitIds() waits for the Insert event to arrive via subscription
// 4. Mutation completes only after event confirmation
```

This ensures the in-memory state is always consistent with the server.

## Utility Methods

```tsx
// Cancel the event subscription
todoCollection.utils.cancel()
```

## Configuration Options

```tsx
trailBaseCollectionOptions<TItem, TRecord>({
  // Required
  recordApi: RecordApi<TRecord>,  // TrailBase record API
  getKey: (item: TItem) => Key,   // Extract unique key

  // Required for type conversions
  parse: {                        // RecordType -> AppType converters
    [field]: (value) => converted,
  },
  serialize: {                    // AppType -> RecordType converters
    [field]: (value) => converted,
  },

  // Optional (inherited from BaseCollectionConfig)
  id?: string,
  schema?: StandardSchema,
})
```

## TrailBase Event Types

The collection handles these event types from the subscription:

| Event Type | Action                        |
| ---------- | ----------------------------- |
| `Insert`   | Add new record to collection  |
| `Update`   | Update existing record        |
| `Delete`   | Remove record from collection |
| `Error`    | Logged to console             |

## Common Patterns

### With Authentication

```tsx
const client = new Client('https://api.example.com', {
  headers: {
    Authorization: `Bearer ${token}`,
  },
})

const recordApi = client.records('todos')

const todoCollection = createCollection(
  trailBaseCollectionOptions<Todo, TodoRecord>({
    recordApi,
    getKey: (item) => item.id,
    parse: {
      /* ... */
    },
    serialize: {
      /* ... */
    },
  }),
)
```

### Multiple Collections

```tsx
const todosApi = client.records('todos')
const projectsApi = client.records('projects')

const todoCollection = createCollection(
  trailBaseCollectionOptions<Todo, TodoRecord>({
    recordApi: todosApi,
    getKey: (item) => item.id,
    parse: {
      /* ... */
    },
    serialize: {
      /* ... */
    },
  }),
)

const projectCollection = createCollection(
  trailBaseCollectionOptions<Project, ProjectRecord>({
    recordApi: projectsApi,
    getKey: (item) => item.id,
    parse: {
      /* ... */
    },
    serialize: {
      /* ... */
    },
  }),
)
```

### Cleanup on Unmount

```tsx
useEffect(() => {
  return () => {
    // Cancel the event reader when component unmounts
    todoCollection.utils.cancel()
  }
}, [])
```

## Error Handling

### Timeout Waiting for Events

If a mutation doesn't receive its confirmation event within the timeout (default: 120 seconds):

```tsx
try {
  await todoCollection.insert({ id: '1', text: 'Hello' })
} catch (error) {
  if (error instanceof TimeoutWaitingForIdsError) {
    // Server didn't send confirmation event in time
    console.error('Mutation confirmation timeout:', error.message)
  }
}
```

### Mutation Type Errors

Invalid mutation types throw specific errors:

```tsx
// ExpectedInsertTypeError - onInsert received non-insert mutation
// ExpectedUpdateTypeError - onUpdate received non-update mutation
// ExpectedDeleteTypeError - onDelete received non-delete mutation
```

## Seen IDs Cleanup

The collection tracks seen IDs to correlate mutations with server events. IDs are automatically cleaned up after 5 minutes to prevent memory leaks.

## Detailed References

| Reference                          | When to Use                             |
| ---------------------------------- | --------------------------------------- |
| `references/event-subscription.md` | Understanding the event stream          |
| `references/type-conversions.md`   | Complex parse/serialize patterns        |
| `references/error-handling.md`     | Handling timeouts and connection errors |
