---
title: Quick Start
id: quick-start
---

TanStack DB is the reactive client-first store for your API. Stop building custom endpoints for every view—query your data however your components need it. This example will show you how to:

- **Load data** into collections using TanStack Query
- **Query data** with blazing-fast live queries
- **Mutate data** with instant optimistic updates

```tsx
import {
  DbClient,
  DbProvider,
  collectionOptions,
  eq,
  useDbClient,
  useLiveQuery,
} from '@tanstack/react-db'
import { QueryClient } from '@tanstack/query-core'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const queryClient = new QueryClient()
const dbClient = new DbClient()

// Define a stable collection descriptor that loads data using TanStack Query
const todoCollection = collectionOptions(
  queryCollectionOptions({
    id: 'todos',
    queryKey: ['todos'],
    queryClient,
    queryFn: async () => {
      const response = await fetch('/api/todos')
      return response.json()
    },
    getKey: (item) => item.id,
    onUpdate: async ({ transaction }) => {
      const { original, modified } = transaction.mutations[0]
      await fetch(`/api/todos/${original.id}`, {
        method: 'PUT',
        body: JSON.stringify(modified),
      })
    },
  })
)

function useTodoCollection() {
  return useDbClient().collection(todoCollection)
}

function Todos() {
  const todosCollection = useTodoCollection()

  // Live query that updates automatically when data changes
  const { data: todos } = useLiveQuery({
    query: (q) =>
      q.from({ todo: todoCollection })
       .where(({ todo }) => eq(todo.completed, false))
       .orderBy(({ todo }) => todo.createdAt, 'desc'),
  })

  const toggleTodo = (todo) => {
    // Instantly applies optimistic state, then syncs to server
    todosCollection.update(todo.id, (draft) => {
      draft.completed = !draft.completed
    })
  }

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id} onClick={() => toggleTodo(todo)}>
          {todo.text}
        </li>
      ))}
    </ul>
  )
}

function App() {
  return (
    <DbProvider client={dbClient}>
      <Todos />
    </DbProvider>
  )
}
```

You now have collections, live queries, and optimistic mutations! Let's break this down further.

## Installation

```bash
npm install @tanstack/react-db @tanstack/query-db-collection @tanstack/query-core
```

## 1. Create a Collection

Collections store your data and handle persistence. The `queryCollectionOptions` loads data using TanStack Query and defines mutation handlers for server sync:

```tsx
const todoCollection = collectionOptions(
  queryCollectionOptions({
    id: 'todos',
    queryKey: ['todos'],
    queryClient,
    queryFn: async () => {
      const response = await fetch('/api/todos')
      return response.json()
    },
    getKey: (item) => item.id,
    // Handle all CRUD operations
    onInsert: async ({ transaction }) => {
      const { modified: newTodo } = transaction.mutations[0]
      await fetch('/api/todos', {
        method: 'POST',
        body: JSON.stringify(newTodo),
      })
    },
    onUpdate: async ({ transaction }) => {
      const { original, modified } = transaction.mutations[0]
      await fetch(`/api/todos/${original.id}`, {
        method: 'PUT', 
        body: JSON.stringify(modified),
      })
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      await fetch(`/api/todos/${original.id}`, { method: 'DELETE' })
    },
  })
)
```

## 2. Materialize the Collection

Use the `DbClient` from context to materialize the descriptor. A tiny collection hook keeps components from repeating the client lookup:

```tsx
function useTodoCollection() {
  return useDbClient().collection(todoCollection)
}
```

## 3. Query with Live Queries

Live queries reactively update when data changes. They support filtering, sorting, joins, and transformations. React hooks derive query identity from the structured query by default, so normal builder queries do not need a separate `queryKey`:

```tsx
function TodoList() {
  // Basic filtering and sorting
  const { data: incompleteTodos } = useLiveQuery({
    query: (q) =>
      q.from({ todo: todoCollection })
       .where(({ todo }) => eq(todo.completed, false))
       .orderBy(({ todo }) => todo.createdAt, 'desc'),
  })

  // Transform the data
  const { data: todoSummary } = useLiveQuery({
    query: (q) =>
      q.from({ todo: todoCollection })
       .select(({ todo }) => ({
         id: todo.id,
         summary: `${todo.text} (${todo.completed ? 'done' : 'pending'})`,
         priority: todo.priority || 'normal'
       })),
  })

  return <div>{/* Render todos */}</div>
}
```

## 4. Optimistic Mutations

Mutations apply instantly and sync to your server. If the server request fails, changes automatically roll back:

```tsx
function TodoActions({ todo }) {
  const todosCollection = useTodoCollection()

  const addTodo = () => {
    todosCollection.insert({
      id: crypto.randomUUID(),
      text: 'New todo',
      completed: false,
      createdAt: new Date(),
    })
  }

  const toggleComplete = () => {
    todosCollection.update(todo.id, (draft) => {
      draft.completed = !draft.completed
    })
  }

  const updateText = (newText) => {
    todosCollection.update(todo.id, (draft) => {
      draft.text = newText
    })
  }

  const deleteTodo = () => {
    todosCollection.delete(todo.id)
  }

  return (
    <div>
      <button onClick={addTodo}>Add Todo</button>
      <button onClick={toggleComplete}>Toggle</button>
      <button onClick={() => updateText('Updated!')}>Edit</button>
      <button onClick={deleteTodo}>Delete</button>
    </div>
  )
}
```

## Next Steps

You now understand the basics of TanStack DB! The collection loads and persists data, live queries provide reactive views, and mutations give instant feedback with automatic server sync.

Explore the docs to learn more about:

- **[Installation](./installation.md)** - All framework and collection packages
- **[Overview](./overview.md)** - Complete feature overview and examples
- **[Live Queries](./guides/live-queries.md)** - Advanced querying, joins, and aggregations
