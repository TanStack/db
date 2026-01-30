# Electric Proxy Setup

Configure a proxy server between clients and Electric.

## Why Use a Proxy?

- **Security**: Control shape parameters server-side
- **Authentication**: Verify user identity before granting access
- **Authorization**: Filter data based on user permissions
- **Flexibility**: Transform or augment shape parameters

## Basic Proxy (TanStack Start)

```typescript
// routes/api/todos.ts
import { createServerFileRoute } from '@tanstack/react-start/server'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

const ELECTRIC_URL = 'http://localhost:3000/v1/shape'

const serve = async ({ request }: { request: Request }) => {
  // Authentication
  const user = await getUser(request)
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const url = new URL(request.url)
  const originUrl = new URL(ELECTRIC_URL)

  // Pass through Electric protocol params
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Set shape parameters (server-controlled)
  originUrl.searchParams.set('table', 'todos')
  originUrl.searchParams.set('where', `user_id = '${user.id}'`)

  // Forward to Electric
  const response = await fetch(originUrl)

  // Clean response headers
  const headers = new Headers(response.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

export const ServerRoute = createServerFileRoute('/api/todos').methods({
  GET: serve
})
```

## Express Proxy

```typescript
import express from 'express'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

const app = express()
const ELECTRIC_URL = 'http://localhost:3000/v1/shape'

app.get('/api/todos', async (req, res) => {
  // Authentication
  const user = await getUser(req)
  if (!user) {
    return res.status(401).send('Unauthorized')
  }

  const originUrl = new URL(ELECTRIC_URL)

  // Pass through Electric params
  Object.entries(req.query).forEach(([key, value]) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value as string)
    }
  })

  // Set shape
  originUrl.searchParams.set('table', 'todos')
  originUrl.searchParams.set('where', `user_id = '${user.id}'`)

  const response = await fetch(originUrl)

  // Stream response
  response.body?.pipeTo(
    new WritableStream({
      write(chunk) { res.write(chunk) },
      close() { res.end() }
    })
  )
})
```

## Next.js API Route

```typescript
// app/api/todos/route.ts
import { NextRequest } from 'next/server'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

const ELECTRIC_URL = 'http://localhost:3000/v1/shape'

export async function GET(request: NextRequest) {
  const user = await getUser(request)
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const originUrl = new URL(ELECTRIC_URL)

  // Pass through Electric params
  request.nextUrl.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Set shape
  originUrl.searchParams.set('table', 'todos')
  originUrl.searchParams.set('where', `user_id = '${user.id}'`)

  const response = await fetch(originUrl)

  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'application/json'
    }
  })
}
```

## Multiple Shapes

Create separate endpoints for different shapes:

```typescript
// /api/todos - User's todos
app.get('/api/todos', async (req, res) => {
  originUrl.searchParams.set('table', 'todos')
  originUrl.searchParams.set('where', `user_id = '${user.id}'`)
  // ...
})

// /api/projects - User's projects
app.get('/api/projects', async (req, res) => {
  originUrl.searchParams.set('table', 'projects')
  originUrl.searchParams.set('where', `org_id = '${user.orgId}'`)
  // ...
})

// /api/team-members - Team members (read-only)
app.get('/api/team-members', async (req, res) => {
  originUrl.searchParams.set('table', 'users')
  originUrl.searchParams.set('columns', 'id,name,avatar_url')
  originUrl.searchParams.set('where', `org_id = '${user.orgId}'`)
  // ...
})
```

## Client Configuration

Point collections to your proxy endpoints:

```tsx
const todosCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    getKey: (item) => item.id,
    shapeOptions: {
      url: '/api/todos'
    }
  })
)

const projectsCollection = createCollection(
  electricCollectionOptions({
    id: 'projects',
    getKey: (item) => item.id,
    shapeOptions: {
      url: '/api/projects'
    }
  })
)
```

## Electric Protocol Params

These params are passed through from client to Electric:

- `offset` - Sync offset for resuming
- `handle` - Shape handle for reconnection
- `live` - Enable live updates
- `cursor` - Pagination cursor

**Never** pass `table`, `where`, or `columns` from client - always set these server-side.

## Environment Configuration

```typescript
// Use environment variables for Electric URL
const ELECTRIC_URL = process.env.ELECTRIC_URL || 'http://localhost:3000/v1/shape'

// Different environments
// Development: http://localhost:3000/v1/shape
// Production: https://electric.yourapp.com/v1/shape
```

## Error Handling

```typescript
app.get('/api/todos', async (req, res) => {
  try {
    const user = await getUser(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const response = await fetch(originUrl)

    if (!response.ok) {
      console.error('Electric error:', response.status)
      return res.status(502).json({ error: 'Sync service unavailable' })
    }

    // Forward response...
  } catch (error) {
    console.error('Proxy error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})
```

## CORS Configuration

If your proxy is on a different domain:

```typescript
app.use('/api', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://yourapp.com')
  res.header('Access-Control-Allow-Credentials', 'true')
  next()
})
```
