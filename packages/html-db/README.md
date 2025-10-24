# @tanstack/html-db

Vanilla JavaScript / HTML integration for TanStack DB - build reactive applications using raw HTML, events, and JavaScript without a virtual DOM framework.

## Overview

This package provides a lightweight integration layer for using TanStack DB with vanilla JavaScript. Unlike framework-specific integrations (React, Vue, etc.), this package gives you direct control over DOM updates while maintaining the powerful reactive query capabilities of TanStack DB.

## Features

- **No Virtual DOM**: Direct DOM manipulation with full control
- **Reactive Queries**: Automatic updates when your data changes
- **Live Query Support**: Real-time filtering, joins, and aggregations
- **Optimistic Updates**: Instant UI feedback with transaction support
- **Type-Safe**: Full TypeScript support
- **Zero Dependencies**: Only depends on `@tanstack/db` core
- **Simple API**: Minimal learning curve, just JavaScript

## Installation

```bash
npm install @tanstack/html-db
# or
pnpm add @tanstack/html-db
# or
yarn add @tanstack/html-db
```

## Quick Start

```typescript
import {
  createCollection,
  createLiveQuery,
  bindToElement,
  eq,
  createTransaction,
} from "@tanstack/html-db"

// Define your data type
interface Todo {
  id: number
  text: string
  completed: boolean
}

// Create a collection
const todosCollection = createCollection<Todo, number>({
  id: "todos",
  getKey: (item) => item.id,
  initialData: [
    { id: 1, text: "Learn TanStack DB", completed: false },
    { id: 2, text: "Build awesome apps", completed: false },
  ],
})

// Start syncing
todosCollection.startSyncImmediate()

// Create a live query
const activeTodosQuery = createLiveQuery((q) =>
  q.from({ todos: todosCollection })
   .where(({ todos }) => eq(todos.completed, false))
)

// Bind to DOM - automatically updates when data changes
bindToElement(activeTodosQuery, "#todos-list", ({ data, isLoading }) => {
  if (isLoading) return "<div>Loading...</div>"

  return `
    <ul>
      ${data.map(todo => `
        <li>${todo.text}</li>
      `).join('')}
    </ul>
  `
})

// Perform mutations
createTransaction({
  mutate: () => {
    todosCollection.insert({ id: 3, text: "New todo", completed: false })
  }
})
```

## Core API

### `createLiveQuery(queryFn, options?)`

Creates a reactive query that automatically updates when the underlying data changes.

```typescript
const query = createLiveQuery((q) =>
  q.from({ todos: todosCollection })
   .where(({ todos }) => eq(todos.completed, false))
)

// Access current data
console.log(query.data)
console.log(query.isReady)

// Subscribe to changes
const unsubscribe = query.subscribe(({ data, isLoading, isError }) => {
  // Update your UI
  updateUI(data)
})

// Clean up
unsubscribe()
query.destroy()
```

### `bindToElement(query, elementOrSelector, renderFn)`

Automatically binds a query to a DOM element and re-renders when data changes.

```typescript
bindToElement(
  todosQuery,
  "#todos-container",
  ({ data, isLoading, isError, status }) => {
    if (isLoading) return "<div>Loading...</div>"
    if (isError) return "<div>Error loading todos</div>"

    return data.map(todo => `<li>${todo.text}</li>`).join('')
  }
)
```

### `createReactiveElement(query, renderFn, options?)`

Creates a new DOM element that automatically updates with query changes.

```typescript
const [element, cleanup] = createReactiveElement(
  todosQuery,
  ({ data }) => data.map(t => `<li>${t.text}</li>`).join(''),
  { tagName: "ul", className: "todos-list" }
)

document.body.appendChild(element)

// Later: cleanup()
```

### `batchSubscribe(queries, renderFn)`

Subscribe to multiple queries and render once when any changes.

```typescript
batchSubscribe([todosQuery, statsQuery], () => {
  renderUI(todosQuery.data, statsQuery.data)
})
```

### Helper Functions

#### `render(element, html, events?)`

Safely render HTML with event delegation support.

```typescript
render(
  container,
  `<button data-action="delete" data-id="1">Delete</button>`,
  {
    'click [data-action="delete"]': (e) => {
      const id = e.target.dataset.id
      deleteTodo(id)
    }
  }
)
```

#### `template` and `html`

Template literals with automatic HTML escaping.

```typescript
import { template, html } from "@tanstack/html-db"

// Safe - escapes HTML
const safe = template`<div>Hello ${userInput}</div>`

// Unsafe - no escaping (use with caution)
const unsafe = html`<div>${trustedHTML}</div>`
```

## Advanced Examples

### Joins

```typescript
const issuesWithUsers = createLiveQuery((q) =>
  q.from({ issues: issueCollection })
   .join({ users: userCollection }, ({ issues, users }) =>
     eq(issues.userId, users.id)
   )
   .select(({ issues, users }) => ({
     id: issues.id,
     title: issues.title,
     userName: users.name
   }))
)
```

### Aggregations

```typescript
const stats = createLiveQuery((q) =>
  q.from({ todos: todosCollection })
   .groupBy(({ todos }) => [todos.completed])
   .select(({ todos }) => ({
     completed: todos.completed,
     count: count()
   }))
)
```

### Dynamic Queries

```typescript
let filter = "all"

const getQuery = () => createLiveQuery((q) => {
  const base = q.from({ todos: todosCollection })

  switch (filter) {
    case "active":
      return base.where(({ todos }) => eq(todos.completed, false))
    case "completed":
      return base.where(({ todos }) => eq(todos.completed, true))
    default:
      return base
  }
})

// Recreate query when filter changes
let query = getQuery()
let cleanup = bindToElement(query, "#list", renderTodos)

// Later, change filter
filter = "active"
cleanup()
query.destroy()
query = getQuery()
cleanup = bindToElement(query, "#list", renderTodos)
```

## Comparison with Framework Integrations

### React (`@tanstack/react-db`)

```typescript
// React
const { data, isLoading } = useLiveQuery((q) =>
  q.from({ todos })
)

// HTML
const query = createLiveQuery((q) => q.from({ todos }))
bindToElement(query, "#container", ({ data, isLoading }) => {
  // return HTML string
})
```

### Key Differences

1. **No Hooks**: Plain functions instead of React hooks
2. **Manual Subscriptions**: Explicit `subscribe()` calls
3. **String-Based Rendering**: Return HTML strings instead of JSX
4. **Direct DOM Access**: Full control over when and how DOM updates
5. **Event Handling**: Standard DOM events, not React's synthetic events

## TypeScript Support

Full TypeScript support with type inference:

```typescript
interface Todo {
  id: number
  text: string
  completed: boolean
}

const collection = createCollection<Todo, number>({
  id: "todos",
  getKey: (item) => item.id,
})

// data is typed as Todo[]
const query = createLiveQuery((q) => q.from({ todos: collection }))

query.subscribe(({ data }) => {
  // data is Todo[]
  data.forEach(todo => {
    console.log(todo.text) // ✓ Type-safe
  })
})
```

## Examples

See the [Todo App example](../../../examples/html/todo) for a complete working application.

## API Reference

For detailed API documentation, see the [TanStack DB docs](https://tanstack.com/db).

## License

MIT
