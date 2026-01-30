# Electric Collection

Real-time sync from Postgres via ElectricSQL.

## Installation

```bash
npm install @tanstack/electric-db-collection @tanstack/react-db
```

## Basic Setup

```tsx
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    getKey: (item) => item.id,
    shapeOptions: {
      url: '/api/todos', // Your Electric proxy
    },
  })
)
```

## Configuration Options

```tsx
electricCollectionOptions({
  // Required
  getKey: (item) => Key,        // Extract unique key
  shapeOptions: {
    url: string,                // Electric proxy URL
    params?: Record<string, string>, // Additional params
  },

  // Optional
  id?: string,                  // Collection identifier
  schema?: StandardSchema,      // Validation schema

  // Mutation handlers
  onInsert?: MutationFn,
  onUpdate?: MutationFn,
  onDelete?: MutationFn,
})
```

## Shapes

Shapes define what data syncs. Configure in your proxy:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `table` | Postgres table | `todos` |
| `where` | Row filter | `user_id = $1` |
| `columns` | Column filter | `id,text,completed` |

**Note:** Configure shapes server-side for security, not client-side.

## Txid Matching

Return transaction IDs to wait for sync:

```tsx
onInsert: async ({ transaction }) => {
  const item = transaction.mutations[0].modified
  const response = await api.todos.create(item)
  return { txid: response.txid }
}
```

Backend must return txid from the same transaction as the mutation:

```typescript
async function createTodo(data: TodoInput) {
  let txid: number

  await db.transaction(async (tx) => {
    // Get txid INSIDE the transaction
    const result = await tx.execute(
      sql`SELECT pg_current_xact_id()::xid::text as txid`
    )
    txid = parseInt(result.rows[0].txid, 10)

    await tx.execute(sql`INSERT INTO todos ${tx(data)}`)
  })

  return { txid }
}
```

## Custom Match Functions

When txids aren't available:

```tsx
import { isChangeMessage } from '@tanstack/electric-db-collection'

onInsert: async ({ transaction, collection }) => {
  const item = transaction.mutations[0].modified
  await api.todos.create(item)

  await collection.utils.awaitMatch(
    (message) =>
      isChangeMessage(message) &&
      message.headers.operation === 'insert' &&
      message.value.text === item.text,
    5000 // timeout ms
  )
}
```

## Utility Methods

```tsx
// Wait for specific txid
await collection.utils.awaitTxId(12345)
await collection.utils.awaitTxId(12345, 10000) // with timeout

// Wait for custom match
await collection.utils.awaitMatch(matchFn, timeout)
```

## Helper Functions

```tsx
import { isChangeMessage, isControlMessage } from '@tanstack/electric-db-collection'

// Check message type
if (isChangeMessage(message)) {
  // message.headers.operation: 'insert' | 'update' | 'delete'
  // message.value: the row data
}

if (isControlMessage(message)) {
  // 'up-to-date' or 'must-refetch'
}
```

## Proxy Example

```typescript
// routes/api/todos.ts
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

const ELECTRIC_URL = 'http://localhost:3000/v1/shape'

export async function GET(request: Request) {
  // Auth check
  const user = await getUser(request)
  if (!user) return new Response('Unauthorized', { status: 401 })

  const url = new URL(request.url)
  const originUrl = new URL(ELECTRIC_URL)

  // Pass through Electric params
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Set shape (server-controlled)
  originUrl.searchParams.set('table', 'todos')
  originUrl.searchParams.set('where', `user_id = '${user.id}'`)

  const response = await fetch(originUrl)
  const headers = new Headers(response.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')

  return new Response(response.body, {
    status: response.status,
    headers,
  })
}
```

## Debugging

Enable debug logging:

```javascript
localStorage.debug = 'ts/db:electric'
```

Common debug output:

```
// Working correctly
ts/db:electric awaitTxId called with txid 123
ts/db:electric new txids synced from pg [123]
ts/db:electric awaitTxId found match for txid 123

// Txid mismatch (common bug)
ts/db:electric awaitTxId called with txid 124
ts/db:electric new txids synced from pg [123]
// Stalls forever - 124 never arrives
```

## With Custom Actions

```tsx
const addTodo = createOptimisticAction<{ text: string }>({
  onMutate: ({ text }) => {
    todoCollection.insert({
      id: crypto.randomUUID(),
      text,
      completed: false,
    })
  },
  mutationFn: async ({ text }) => {
    const response = await api.todos.create({ text })
    await todoCollection.utils.awaitTxId(response.txid)
  },
})
```

## Real-Time Updates

Electric automatically streams changes. No polling needed:

```tsx
// Changes sync automatically when:
// 1. Another user modifies data
// 2. Backend process updates database
// 3. Database trigger fires

// Your live queries update automatically
const { data } = useLiveQuery((q) =>
  q.from({ todo: todoCollection })
)
// `data` updates in real-time
```
