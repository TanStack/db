---
"@tanstack/react-db": minor
---

Add SSR/RSC support for live queries

Implements server-side rendering (SSR) and React Server Components (RSC) support for live queries, following TanStack Query's hydration patterns. This enables React applications using TanStack DB to efficiently execute live queries on the server, serialize the results, and hydrate them on the client for optimal initial page loads.

**New APIs:**

- `createServerContext()` - Creates a server context for managing query prefetching
- `prefetchLiveQuery()` - Executes live queries on the server and stores results
- `dehydrate()` - Serializes query results for client transfer
- `hydrate()` - Populates global state with dehydrated data
- `HydrationBoundary` - React component that provides hydrated data to child components
- `useHydratedQuery()` - Hook to access hydrated data from context (internal)

**Features:**

- Automatic hydration detection in `useLiveQuery` when collection is empty
- Seamless transition from server-rendered data to live reactive updates
- Minimal payload - only query results are transferred, not full collection state
- Supports both HydrationBoundary context and direct `hydrate()` approaches
- Works with Next.js App Router, Remix, and other SSR/RSC frameworks

**Example usage:**

```tsx
// Server Component
async function Page() {
  const serverContext = createServerContext()

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
function TodoList() {
  const { data } = useLiveQuery({
    id: 'todos',
    query: (q) => q.from({ todos: todosCollection })
  })

  return <div>{data.map(todo => <Todo key={todo.id} {...todo} />)}</div>
}
```

Closes #545
