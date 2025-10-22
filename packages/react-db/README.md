# @tanstack/react-db

React hooks for TanStack DB. See [TanStack/db](https://github.com/TanStack/db) for more details.

## Server-Side Rendering (SSR) & React Server Components (RSC)

`@tanstack/react-db` supports SSR and RSC through a hydration pattern similar to TanStack Query. This enables server-side query execution with seamless client-side hydration and live updates.

### Basic Usage

```tsx
// Server Component (Next.js App Router)
import { createServerContext, prefetchLiveQuery, dehydrate, HydrationBoundary } from '@tanstack/react-db'
import { todosCollection } from './collections'

async function TodosPage() {
  const serverContext = createServerContext()

  // Prefetch queries on the server
  await prefetchLiveQuery(serverContext, {
    id: 'todos',
    query: (q) => q.from({ todos: todosCollection })
  })

  return (
    <HydrationBoundary state={dehydrate(serverContext)}>
      <TodoList />
    </HydrationBoundary>
  )
}

// Client Component
'use client'
import { useLiveQuery } from '@tanstack/react-db'
import { todosCollection } from './collections'

function TodoList() {
  const { data, isReady } = useLiveQuery({
    id: 'todos', // Must match the id used in prefetchLiveQuery
    query: (q) => q.from({ todos: todosCollection })
  })

  return <div>{data.map(todo => <Todo key={todo.id} {...todo} />)}</div>
}
```

### API Reference

- **`createServerContext()`** - Creates a server context to collect prefetched queries
- **`prefetchLiveQuery(context, options)`** - Executes a query on the server
- **`dehydrate(context)`** - Serializes prefetched queries for client hydration
- **`HydrationBoundary`** - React component that provides hydrated data to descendants
- **`hydrate(state)`** - Manual hydration for non-React contexts

### Important Constraints

#### Data Serialization

For SSR/RSC to work correctly, all query data **must be JSON-serializable**. Non-serializable types will cause runtime errors during hydration.

**Supported types:**
- Primitives: `string`, `number`, `boolean`, `null`
- Objects and arrays (plain objects only)
- JSON-serializable structures

**Unsupported types that require special handling:**
- `Date` objects (serialize as ISO strings, then parse on client)
- `BigInt` values (convert to strings or numbers)
- `Map`, `Set`, `WeakMap`, `WeakSet`
- Class instances with methods
- Functions, symbols
- `undefined` values (use `null` instead)

**Example of handling Date objects:**

```tsx
// Server-side prefetch
await prefetchLiveQuery(serverContext, {
  id: 'events',
  query: async (q) => {
    const results = await q.from({ events: eventsCollection }).toArray()
    // Convert Date objects to ISO strings
    return results.map(event => ({
      ...event,
      createdAt: event.createdAt.toISOString()
    }))
  }
})

// Client-side usage
const { data } = useLiveQuery({
  id: 'events',
  query: (q) => q.from({ events: eventsCollection })
})

// Parse ISO strings back to Date objects if needed
const eventsWithDates = data.map(event => ({
  ...event,
  createdAt: new Date(event.createdAt)
}))
```

**For complex serialization needs**, consider using libraries like:
- [`superjson`](https://github.com/blitz-js/superjson) - Handles Date, RegExp, Map, Set, BigInt, etc.
- [`devalue`](https://github.com/Rich-Harris/devalue) - Lightweight alternative with circular reference support

### Query Identity

Both `prefetchLiveQuery` and `useLiveQuery` require an explicit `id` option for hydration to work. The IDs must match exactly:

```tsx
// Server
await prefetchLiveQuery(serverContext, {
  id: 'user-123', // ← Must match
  query: (q) => q.from({ users }).where(...)
})

// Client
useLiveQuery({
  id: 'user-123', // ← Must match
  query: (q) => q.from({ users }).where(...)
})
```

Without matching IDs, the client will not use the prefetched data and will wait for the collection to load.
