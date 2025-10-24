# TanStack DB - Vanilla HTML Todo App

A simple todo application demonstrating how to use TanStack DB with raw HTML, events, and JavaScript (no virtual DOM framework).

## Features

- **No Virtual DOM**: Direct DOM manipulation using vanilla JavaScript
- **Reactive Updates**: Automatically updates UI when data changes
- **Live Queries**: Real-time filtering without manual re-querying
- **Optimistic Updates**: Instant UI feedback with transaction support
- **Type-Safe**: Full TypeScript support
- **In-Memory Store**: Simulates backend persistence

## What This Demo Shows

This example demonstrates:

1. **Creating Collections**: Set up a TanStack DB collection with CRUD operations
2. **Live Queries**: Use `createLiveQuery` for reactive data subscriptions
3. **Manual DOM Updates**: Use `bindToElement` to automatically update DOM on data changes
4. **Event Handling**: Standard DOM event listeners for user interactions
5. **Transactions**: Optimistic updates with `createTransaction`
6. **Dynamic Queries**: Switch between filtered views (all/active/completed)

## Architecture

The app uses the `@tanstack/html-db` package which provides:

- `createLiveQuery()` - Create reactive queries that notify on changes
- `bindToElement()` - Automatically bind query results to DOM elements
- `createTransaction()` - Perform optimistic mutations
- Standard TanStack DB features (collections, queries, etc.)

## Running the Example

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev
```

## Code Overview

### Creating a Collection

```typescript
const todosCollection = createCollection<Todo, number>({
  id: "todos",
  getKey: (item) => item.id,
  initialData: [...],
  onInsert: async ({ transaction }) => { /* ... */ },
  onUpdate: async ({ transaction }) => { /* ... */ },
  onDelete: async ({ transaction }) => { /* ... */ },
})
```

### Creating Live Queries

```typescript
const filteredQuery = createLiveQuery((q) => {
  const query = q.from({ todos: todosCollection })

  if (filter === "active") {
    return query.where(({ todos }) => eq(todos.completed, false))
  }

  return query
})
```

### Binding to DOM

```typescript
bindToElement(filteredQuery, "#todo-list", ({ data, isLoading }) => {
  if (isLoading) return '<div>Loading...</div>'

  return data.map(todo => `
    <li>${todo.text}</li>
  `).join('')
})
```

### Mutations

```typescript
createTransaction({
  mutate: () => {
    todosCollection.insert({ text: "New todo", completed: false })
  }
})
```

## Key Differences from React

Unlike `@tanstack/react-db`:

- **No Hooks**: Uses plain functions instead of `useLiveQuery`
- **Manual Subscriptions**: Explicit `subscribe()` calls instead of automatic re-renders
- **Direct DOM**: Updates DOM directly instead of React's virtual DOM
- **Event Listeners**: Standard DOM events instead of React's synthetic events

## Learn More

- [TanStack DB Documentation](https://tanstack.com/db)
- [API Reference](https://tanstack.com/db/latest/docs/api/core)
