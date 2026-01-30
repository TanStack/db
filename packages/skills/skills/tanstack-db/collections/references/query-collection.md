# Query Collection

Load data from REST APIs using TanStack Query.

## Installation

```bash
npm install @tanstack/query-db-collection @tanstack/react-db @tanstack/react-query
```

## Basic Setup

```tsx
import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { QueryClient } from '@tanstack/react-query'

const queryClient = new QueryClient()

const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => {
      const response = await fetch('/api/todos')
      return response.json()
    },
    getKey: (item) => item.id,
    queryClient,
  })
)
```

## Configuration Options

```tsx
queryCollectionOptions({
  // Required
  queryKey: QueryKey,           // TanStack Query cache key
  queryFn: QueryFn,             // Data fetching function
  getKey: (item) => Key,        // Extract unique key from item

  // Optional
  queryClient?: QueryClient,    // Your query client instance
  schema?: StandardSchema,      // Validation schema
  syncMode?: 'eager' | 'on-demand' | 'progressive',

  // Mutation handlers
  onInsert?: MutationFn,
  onUpdate?: MutationFn,
  onDelete?: MutationFn,
})
```

## Predicate Push-Down

With `syncMode: 'on-demand'`, query predicates are passed to your queryFn:

```tsx
const productsCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['products'],
    queryFn: async (ctx) => {
      // ctx.meta.loadSubsetOptions contains query predicates
      const params = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions)
      // params: { where: { category: 'electronics', price_lt: 100 }, limit: 50 }

      const url = new URL('/api/products')
      if (params.where?.category) {
        url.searchParams.set('category', params.where.category)
      }
      if (params.where?.price_lt) {
        url.searchParams.set('price_lt', params.where.price_lt)
      }
      if (params.limit) {
        url.searchParams.set('limit', params.limit)
      }

      return fetch(url).then((r) => r.json())
    },
    getKey: (item) => item.id,
    syncMode: 'on-demand',
  })
)

// This query triggers API call with predicates
const { data } = useLiveQuery((q) =>
  q
    .from({ product: productsCollection })
    .where(({ product }) => eq(product.category, 'electronics'))
    .where(({ product }) => lt(product.price, 100))
    .limit(50)
)
```

## Delta Loading

QueryCollection automatically handles delta loading:

```tsx
// First query loads: category=electronics
const q1 = q.where(({ p }) => eq(p.category, 'electronics'))

// Second query expands: category=electronics OR category=clothing
// Only loads clothing items, keeps electronics from cache
const q2 = q.where(({ p }) =>
  or(eq(p.category, 'electronics'), eq(p.category, 'clothing'))
)
```

## Refetching

```tsx
// Manual refetch
await todoCollection.utils.refetch()

// Refetch on window focus (via TanStack Query)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
    },
  },
})
```

## Direct Writes

For real-time updates (WebSocket, SSE), write directly to collection:

```tsx
// Listen to real-time updates
websocket.on('todo:created', (todo) => {
  todoCollection.utils.directWrite('insert', todo)
})

websocket.on('todo:updated', (todo) => {
  todoCollection.utils.directWrite('update', todo)
})

websocket.on('todo:deleted', ({ id }) => {
  todoCollection.utils.directWrite('delete', id)
})
```

## With TanStack Query Hooks

Access underlying query state:

```tsx
import { useQuery } from '@tanstack/react-query'

function TodoStats() {
  const { isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ['todos'],
    // Query is managed by collection, this just accesses state
  })

  return (
    <div>
      {isLoading && <span>Loading...</span>}
      {isError && <span>Error loading todos</span>}
      <span>Last updated: {new Date(dataUpdatedAt).toLocaleString()}</span>
    </div>
  )
}
```

## Mutation Handlers

QueryCollection auto-refetches after handlers complete:

```tsx
queryCollectionOptions({
  onInsert: async ({ transaction }) => {
    await fetch('/api/todos', {
      method: 'POST',
      body: JSON.stringify(transaction.mutations[0].modified),
    })
    // Auto-refetch happens after this returns
  },

  onUpdate: async ({ transaction }) => {
    const { original, changes } = transaction.mutations[0]
    await fetch(`/api/todos/${original.id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    })
  },

  onDelete: async ({ transaction }) => {
    await fetch(`/api/todos/${transaction.mutations[0].original.id}`, {
      method: 'DELETE',
    })
  },
})
```

## Stale Time and Caching

Control cache behavior via TanStack Query options:

```tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000,   // 10 minutes
    },
  },
})
```

## Error Handling

```tsx
const todoCollection = createCollection(
  queryCollectionOptions({
    queryFn: async () => {
      const response = await fetch('/api/todos')
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      return response.json()
    },
  })
)

// Check collection state
if (todoCollection.state.isError) {
  console.log(todoCollection.state.error)
}
```

## Multiple Query Keys

For filtered views, use different query keys:

```tsx
const activeTodos = createCollection(
  queryCollectionOptions({
    queryKey: ['todos', 'active'],
    queryFn: () => fetch('/api/todos?status=active').then((r) => r.json()),
    getKey: (item) => item.id,
  })
)

const completedTodos = createCollection(
  queryCollectionOptions({
    queryKey: ['todos', 'completed'],
    queryFn: () => fetch('/api/todos?status=completed').then((r) => r.json()),
    getKey: (item) => item.id,
  })
)
```
