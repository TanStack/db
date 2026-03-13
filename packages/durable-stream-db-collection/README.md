# @tanstack/durable-stream-db-collection

TanStack DB collection for [Durable Streams](https://github.com/durable-streams/durable-streams).

## Installation

```bash
npm install @tanstack/durable-stream-db-collection @tanstack/db @durable-streams/client
```

> **Note:** `@durable-streams/client` is a peer dependency. Install a compatible Durable Streams client that implements the [Durable Streams protocol](https://github.com/durable-streams/durable-streams).

## Quick Start

```typescript
import { createCollection } from '@tanstack/db'
import { durableStreamCollectionOptions } from '@tanstack/durable-stream-db-collection'

const eventsCollection = createCollection(
  durableStreamCollectionOptions({
    url: 'https://api.example.com/v1/stream/events',
    getKey: (row) => row.id,
    getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
  })
)
```

## Key Concepts

### Batch-Level Offsets

Durable Streams uses batch-level offsets, not row-level. When resuming from an offset, the entire batch may replay. This package handles deduplication automatically using your `getDeduplicationKey` function.

### JSON Mode Requirement

This package requires Durable Streams servers running in **JSON mode** (`content-type: application/json`). In JSON mode:

- Each append is a valid JSON value
- Reads return parsed JSON arrays
- Message boundaries are preserved

### Read-Only

This collection is read-only. To write data, use your stream's append endpoint directly or through a wrapper protocol.

### Offset Persistence

Offsets are automatically persisted to localStorage (configurable) for cross-session resumption.

## API Reference

### `durableStreamCollectionOptions`

Creates TanStack DB collection configuration for a Durable Stream.

```typescript
interface DurableStreamCollectionConfig<TRow> {
  // Required
  url: string                              // URL of the Durable Stream endpoint
  getKey: (row: TRow) => string | number   // Extract primary key from row
  getDeduplicationKey: (row: TRow) => string // Extract deduplication key from row

  // Optional
  id?: string                              // Collection ID (auto-generated from URL if not provided)
  schema?: StandardSchemaV1<TRow>          // Standard Schema for validation
  initialOffset?: string                   // Initial offset (default: '-1' for beginning)
  headers?: Record<string, string>         // HTTP headers for requests
  reconnectDelay?: number                  // Delay before reconnecting after error (default: 5000ms)
  liveMode?: 'long-poll' | 'sse'           // Live mode (default: 'long-poll')
  storageKey?: string | false              // Storage key prefix (default: 'durable-stream')
  storage?: OffsetStorage                  // Custom storage adapter
}
```

### Output Type

Each row from the collection includes the batch offset:

```typescript
type RowWithOffset<TRow> = TRow & { offset: string }
```

## Usage Examples

### Basic Usage

```typescript
import { createCollection } from '@tanstack/db'
import { durableStreamCollectionOptions } from '@tanstack/durable-stream-db-collection'

interface Event {
  id: string
  type: string
  payload: unknown
  timestamp: string
}

const eventsCollection = createCollection(
  durableStreamCollectionOptions<Event>({
    url: 'https://api.example.com/v1/stream/events',
    getKey: (row) => row.id,
    getDeduplicationKey: (row) => row.id,
  })
)

// Preload the collection
await eventsCollection.preload()

// Access data
const events = eventsCollection.toArray
console.log(`Loaded ${events.length} events`)
```

### With Schema Validation

```typescript
import { z } from 'zod'
import { createCollection } from '@tanstack/db'
import { durableStreamCollectionOptions } from '@tanstack/durable-stream-db-collection'

const eventSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.unknown(),
  timestamp: z.string(),
  seq: z.number(),
})

type Event = z.infer<typeof eventSchema>

const eventsCollection = createCollection(
  durableStreamCollectionOptions<Event>({
    url: 'https://api.example.com/v1/stream/events',
    getKey: (row) => row.id,
    getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
    schema: eventSchema,
  })
)
```

### With Authentication

```typescript
const eventsCollection = createCollection(
  durableStreamCollectionOptions<Event>({
    url: 'https://api.example.com/v1/stream/events',
    getKey: (row) => row.id,
    getDeduplicationKey: (row) => row.id,
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  })
)
```

### Custom Storage Adapter

```typescript
// For React Native with AsyncStorage
import AsyncStorage from '@react-native-async-storage/async-storage'

const eventsCollection = createCollection(
  durableStreamCollectionOptions<Event>({
    url: 'https://api.example.com/v1/stream/events',
    getKey: (row) => row.id,
    getDeduplicationKey: (row) => row.id,
    storage: AsyncStorage,
  })
)
```

### Disable Offset Persistence

```typescript
const eventsCollection = createCollection(
  durableStreamCollectionOptions<Event>({
    url: 'https://api.example.com/v1/stream/events',
    getKey: (row) => row.id,
    getDeduplicationKey: (row) => row.id,
    storageKey: false, // No persistence
  })
)
```

### With React

```typescript
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'

function EventList() {
  const { data: events } = useLiveQuery((q) =>
    q.from({ event: eventsCollection })
      .where(({ event }) => eq(event.type, 'user.created'))
      .orderBy(({ event }) => event.timestamp, 'desc')
  )

  return (
    <ul>
      {events.map(event => (
        <li key={event.id}>
          {event.type}: {JSON.stringify(event.payload)}
        </li>
      ))}
    </ul>
  )
}
```

## Deduplication Strategy

When resuming from a batch offset, Durable Streams may replay the entire batch. The `getDeduplicationKey` function is critical for filtering out already-seen rows.

**Common patterns:**

```typescript
// Rows with unique IDs
getDeduplicationKey: (row) => row.id

// Rows with sequence numbers per entity
getDeduplicationKey: (row) => `${row.entityId}:${row.seq}`

// Composite keys
getDeduplicationKey: (row) => `${row.timestamp}:${row.id}`
```

The deduplication key must be:
- **Unique** within the stream
- **Deterministic** - the same row always produces the same key

## Reconnection Behavior

On error, the collection will:
1. Mark as ready (if not already) to avoid blocking UI
2. Wait for `reconnectDelay` milliseconds (default: 5000)
3. Reconnect and resume from the last successful offset

## License

MIT
