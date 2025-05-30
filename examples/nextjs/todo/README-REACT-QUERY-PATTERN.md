# React Query-like Implementation with Collections

This implementation now follows the React Query patterns more closely while using TanStack DB Collections instead of React Query, with support for arbitrary collections.

## Pattern Comparison

### Original React Query Pattern

```tsx
// _app.tsx
function MyApp({ Component, pageProps }) {
  const [queryClient] = React.useState(() => new QueryClient())
  
  return (
    <QueryClientProvider client={queryClient}>
      <Component {...pageProps} />
    </QueryClientProvider>
  )
}

// pages/posts.tsx
export async function getStaticProps() {
  const queryClient = new QueryClient()
  
  await queryClient.prefetchQuery({
    queryKey: ['posts'],
    queryFn: getPosts,
  })
  
  return {
    props: {
      dehydratedState: dehydrate(queryClient),
    },
  }
}

function Posts() {
  const { data } = useQuery({ queryKey: ['posts'], queryFn: getPosts })
  // ...
}

export default function PostsRoute({ dehydratedState }) {
  return (
    <HydrationBoundary state={dehydratedState}>
      <Posts />
    </HydrationBoundary>
  )
}
```

### Our Collection-based Implementation

```tsx
// app/layout.tsx (Server Component)
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <CollectionProviders>{children}</CollectionProviders>
      </body>
    </html>
  )
}

// app/CollectionProviders.tsx (Client Component)
export function CollectionProviders({ children }) {
  const [collectionClient] = React.useState(() =>
    createCollectionClient([], [], {
      defaultOptions: {
        staleTime: 60 * 1000,
      },
    })
  )

  return (
    <CollectionClientProvider client={collectionClient}>
      {children}
    </CollectionClientProvider>
  )
}

// app/page.tsx (Server Component)
export default async function TodoPage() {
  const { initialTodos, initialConfig } = await fetchInitialData()
  
  // Create a temporary collection client to prefetch data
  const serverCollectionClient = createCollectionClient(initialTodos, initialConfig)
  
  // Dehydrate the collection state (works with arbitrary collections)
  const dehydratedState = dehydrateCollections(serverCollectionClient)

  return (
    <CollectionHydrationBoundary state={dehydratedState}>
      <TodoClient />
    </CollectionHydrationBoundary>
  )
}

// app/TodoClient.tsx (Client Component using collections)
export default function TodoClient() {
  const { data: todos, collection: todoCollection } = useTodosCollection()
  const { data: configData, collection: configCollection } = useConfigCollection()
  // ...
}
```

## Architecture Overview

### File Structure & Responsibilities

1. **`app/layout.tsx`** (Server Component)
   - Root layout that stays server-side
   - Wraps children with `<CollectionProviders>`

2. **`app/CollectionProviders.tsx`** (Client Component)
   - Creates and provides the `CollectionClient` instance
   - Similar to React Query's `QueryClientProvider` setup

3. **`app/page.tsx`** (Server Component)  
   - Fetches initial data on the server
   - Creates dehydrated state using temporary collection client
   - Wraps page with `<CollectionHydrationBoundary>`

4. **`app/TodoClient.tsx`** (Client Component)
   - Uses collection hooks (`useTodosCollection`, `useConfigCollection`) 
   - Pure UI component that consumes data

## Key Components

### 1. CollectionClient (Generic)

The `CollectionClient` now supports arbitrary collections via `getAllCollections()`:

```tsx
export interface CollectionClient {
  todoCollection: ElectricCollection<UpdateTodo>
  configCollection: ElectricCollection<UpdateConfig>
  mount: () => void
  unmount: () => void
  getAllCollections: () => Record<string, ElectricCollection<any>>
}

// Implementation
const client: CollectionClient = {
  todoCollection,
  configCollection,
  getAllCollections() {
    return {
      todos: todoCollection,
      config: configCollection,
      // Add more collections here as needed
    }
  }
}
```

### 2. Generic Dehydration

The `dehydrateCollections` function now works with any number of collections:

```tsx
export function dehydrateCollections(client: CollectionClient) {
  const collections = client.getAllCollections()
  const dehydratedState: Record<string, Array<any>> = {}
  
  Object.entries(collections).forEach(([key, collection]) => {
    dehydratedState[key] = Array.from(collection.state.values())
  })
  
  return dehydratedState
}
```

### 3. Generic Hydration

The `CollectionHydrationBoundary` automatically handles any collections:

```tsx
export interface DehydratedCollectionState {
  [collectionKey: string]: Array<any>
}

function hydrateCollections(client: CollectionClient, data: DehydratedCollectionState) {
  const clientCollections = client.getAllCollections()

  Object.entries(data).forEach(([collectionKey, items]) => {
    const collection = clientCollections[collectionKey]
    
    collection.syncedData.setState((prevData) => {
      const newData = new Map(prevData)
      items.forEach((item: any) => {
        const key = `${collectionKey}-${item.id}`
        newData.set(key, item)
        collection.objectKeyMap.set(item, key)
      })
      return newData
    })
  })
}
```

### 4. Collection Hooks

Similar to `useQuery`, provide access to collection data:

```tsx
export function useTodosCollection() {
  const client = useCollectionClient()
  
  const { data: todos } = useLiveQuery((q) =>
    q.from({ todoCollection: client.todoCollection })
     .keyBy(`@id`)
     .orderBy(`@created_at`)
     .select(`@id`, `@created_at`, `@text`, `@completed`)
  )

  return { data: todos, collection: client.todoCollection }
}
```

## Adding New Collections

To add a new collection, simply:

1. **Update `createCollectionClient`:**
```tsx
const newCollection = createElectricCollection<NewType>({ ... })

return {
  todoCollection,
  configCollection,
  newCollection, // Add here
  getAllCollections() {
    return {
      todos: todoCollection,
      config: configCollection,
      new: newCollection, // And here
    }
  }
}
```

2. **Create a hook:**
```tsx
export function useNewCollection() {
  const client = useCollectionClient()
  return { data: ..., collection: client.newCollection }
}
```

3. **Done!** Dehydration and hydration work automatically.

## Benefits of This Pattern

1. **Familiar API**: Developers familiar with React Query will feel at home
2. **Proper SSR/Hydration**: Follows best practices for server rendering
3. **Data Isolation**: Each request gets its own collection client instance
4. **Provider Pattern**: Collections are available anywhere in the component tree
5. **Dehydration/Hydration**: Seamless transfer of server data to client
6. **Type Safety**: Full TypeScript support throughout
7. **Server/Client Separation**: Clear boundaries between server and client components
8. **🆕 Generic Collections**: Works with arbitrary number of collections
9. **🆕 Extensible**: Easy to add new collections without changing core logic

## Provider Hierarchy

```
app/layout.tsx (Server)
├── CollectionProviders.tsx (Client) 
│   └── CollectionClientProvider
│       └── app/page.tsx (Server)
│           └── CollectionHydrationBoundary (handles N collections)
│               └── TodoClient.tsx (Client)
│                   └── useTodosCollection()
│                   └── useConfigCollection()
│                   └── useAnyOtherCollection()
```

This pattern provides the same benefits as React Query while leveraging the power of TanStack DB Collections for real-time data synchronization, with proper separation of server and client concerns and full support for arbitrary collections. 