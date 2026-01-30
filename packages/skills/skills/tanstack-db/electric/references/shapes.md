# Electric Shapes

Define what data syncs from Postgres.

## Overview

Shapes configure which rows and columns Electric syncs to the client. Configure shapes **server-side** in your proxy for security.

## Shape Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `table` | Postgres table name | `todos` |
| `where` | SQL WHERE clause | `user_id = '123'` |
| `columns` | Columns to include | `id,text,completed` |

## Proxy Configuration

Configure shapes in your Electric proxy, not on the client:

```typescript
// routes/api/todos.ts
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

const ELECTRIC_URL = 'http://localhost:3000/v1/shape'

export async function GET(request: Request) {
  const user = await getUser(request)
  if (!user) return new Response('Unauthorized', { status: 401 })

  const url = new URL(request.url)
  const originUrl = new URL(ELECTRIC_URL)

  // Pass through Electric protocol params
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Set shape (server-controlled for security)
  originUrl.searchParams.set('table', 'todos')
  originUrl.searchParams.set('where', `user_id = '${user.id}'`)

  const response = await fetch(originUrl)
  return new Response(response.body, {
    status: response.status,
    headers: response.headers
  })
}
```

## Client Setup

Client just points to proxy URL:

```tsx
const todosCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    getKey: (item) => item.id,
    shapeOptions: {
      url: '/api/todos',  // Your proxy
    }
  })
)
```

## Column Filtering

Sync only needed columns to reduce bandwidth:

```typescript
// Proxy configuration
originUrl.searchParams.set('table', 'users')
originUrl.searchParams.set('columns', 'id,name,email,avatar_url')
// Excludes large fields like bio, preferences JSON, etc.
```

## Row Filtering

Filter rows with WHERE clauses:

```typescript
// Only active todos
originUrl.searchParams.set('table', 'todos')
originUrl.searchParams.set('where', 'completed = false')

// User-scoped data
originUrl.searchParams.set('table', 'documents')
originUrl.searchParams.set('where', `owner_id = '${user.id}'`)

// Complex conditions
originUrl.searchParams.set('where',
  `org_id = '${user.orgId}' AND archived = false`)
```

## Custom Match Functions

When txid matching isn't available, use custom match functions:

```tsx
import { isChangeMessage, isControlMessage } from '@tanstack/electric-db-collection'

onInsert: async ({ transaction, collection }) => {
  const newItem = transaction.mutations[0].modified
  await api.todos.create(newItem)

  await collection.utils.awaitMatch(
    (message) => {
      if (!isChangeMessage(message)) return false
      return (
        message.headers.operation === 'insert' &&
        message.value.text === newItem.text
      )
    },
    5000  // timeout in ms
  )
}
```

## Message Types

Electric streams two message types:

### Change Messages

Data operations from Postgres:

```tsx
if (isChangeMessage(message)) {
  // message.headers.operation: 'insert' | 'update' | 'delete'
  // message.value: the row data
  console.log(message.headers.operation)
  console.log(message.value.id)
}
```

### Control Messages

Stream status updates:

```tsx
if (isControlMessage(message)) {
  // 'up-to-date' - stream is current
  // 'must-refetch' - need to refetch shape
}
```

## Match Function Patterns

### Match by ID

```tsx
await collection.utils.awaitMatch(
  (message) =>
    isChangeMessage(message) &&
    message.value.id === expectedId
)
```

### Match by Operation Type

```tsx
await collection.utils.awaitMatch(
  (message) =>
    isChangeMessage(message) &&
    message.headers.operation === 'delete'
)
```

### Match by Multiple Fields

```tsx
await collection.utils.awaitMatch(
  (message) =>
    isChangeMessage(message) &&
    message.headers.operation === 'insert' &&
    message.value.user_id === userId &&
    message.value.title === title
)
```

## Timeout Handling

Match functions have configurable timeouts:

```tsx
try {
  await collection.utils.awaitMatch(matchFn, 5000)
} catch (error) {
  // Handle timeout - sync didn't arrive in time
  console.error('Sync timeout')
}
```

## Simple Timeout Approach

For prototyping when precise matching isn't needed:

```tsx
onInsert: async ({ transaction }) => {
  const newItem = transaction.mutations[0].modified
  await api.todos.create(newItem)

  // Simple wait - crude but works for prototyping
  await new Promise(resolve => setTimeout(resolve, 2000))
}
```

**Note:** Use txid matching in production for reliability.
