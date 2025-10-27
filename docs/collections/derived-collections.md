---
title: Derived Collections
---

# Derived Collections

Derived collections are collections created from live queries over other collections, acting as materialized views that automatically update when source data changes.

## Overview

Live queries in TanStack DB return collections. This powerful feature allows you to:
- Create filtered subsets of existing collections
- Join multiple collections into a unified view
- Aggregate and transform data from source collections
- Chain derivations recursively (derive from other derived collections)
- Maintain materialized views that update incrementally using differential dataflow

## Installation

Derived collections use the core TanStack DB package:

```bash
npm install @tanstack/db
```

## Basic Usage

Create a derived collection using `createLiveQueryCollection`:

```typescript
import { createLiveQueryCollection } from '@tanstack/db'

// Source collection
const todoCollection = createCollection({
  // ... config
})

// Derived collection: only completed todos
const completedTodoCollection = createLiveQueryCollection({
  startSync: true,
  query: (q) =>
    q.from({ todo: todoCollection })
      .where(({ todo }) => todo.completed),
})
```

## Configuration Options

The `createLiveQueryCollection` function accepts the following options:

### Required Options

- `query`: A function that receives a query builder and returns a query. The query result becomes the collection's data.

### Optional Options

- `startSync`: Boolean indicating whether to immediately start the query subscription (default: `false`)
- `id`: Unique identifier for the collection (auto-generated if not provided)

## Simple Filtering

Create derived collections that filter source collections:

```typescript
import { createLiveQueryCollection, eq } from '@tanstack/db'

const todoCollection = createCollection({
  // ... config
})

// Only pending todos
const pendingTodoCollection = createLiveQueryCollection({
  startSync: true,
  query: (q) =>
    q.from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.status, 'pending')),
})

// Only high-priority todos
const highPriorityTodoCollection = createLiveQueryCollection({
  startSync: true,
  query: (q) =>
    q.from({ todo: todoCollection })
      .where(({ todo }) => todo.priority > 7),
})
```

## Joining Multiple Collections

Derive collections from multiple source collections using joins:

```typescript
import { createLiveQueryCollection, eq } from '@tanstack/db'

const todoCollection = createCollection({
  // ... config
})

const listCollection = createCollection({
  // ... config
})

// Todos with their list information
const todosWithListsCollection = createLiveQueryCollection({
  startSync: true,
  query: (q) =>
    q.from({ todo: todoCollection })
      .join(
        { list: listCollection },
        ({ todo, list }) => eq(list.id, todo.listId),
        'inner'
      )
      .select(({ todo, list }) => ({
        id: todo.id,
        text: todo.text,
        listName: list.name,
        listColor: list.color,
      })),
})
```

## Transforming Data

Use `select` to transform and shape the derived collection data:

```typescript
import { createLiveQueryCollection } from '@tanstack/db'

const userCollection = createCollection({
  // ... config
})

// Derived collection with computed fields
const userSummaryCollection = createLiveQueryCollection({
  startSync: true,
  query: (q) =>
    q.from({ user: userCollection })
      .select(({ user }) => ({
        id: user.id,
        fullName: `${user.firstName} ${user.lastName}`,
        initials: `${user.firstName[0]}${user.lastName[0]}`,
        isActive: user.lastSeen > Date.now() - 300000, // Active in last 5 min
      })),
})
```

## Aggregations

Create derived collections with aggregated data:

```typescript
import { createLiveQueryCollection } from '@tanstack/db'

const orderCollection = createCollection({
  // ... config
})

// Orders grouped by status with counts
const orderStatsByStatusCollection = createLiveQueryCollection({
  startSync: true,
  query: (q) =>
    q.from({ order: orderCollection })
      .groupBy(({ order }) => order.status)
      .select(({ order }) => ({
        status: order.status,
        count: count(order.id),
        totalAmount: sum(order.amount),
      })),
})
```

## Recursive Derivations

Derive collections from other derived collections:

```typescript
import { createLiveQueryCollection, eq } from '@tanstack/db'

// Base collection
const todoCollection = createCollection({
  // ... config
})

// First level: completed todos
const completedTodoCollection = createLiveQueryCollection({
  startSync: true,
  query: (q) =>
    q.from({ todo: todoCollection })
      .where(({ todo }) => todo.completed),
})

// Second level: completed high-priority todos
const completedHighPriorityCollection = createLiveQueryCollection({
  startSync: true,
  query: (q) =>
    q.from({ todo: completedTodoCollection })
      .where(({ todo }) => todo.priority > 7),
})

// Changes propagate efficiently through the chain
```

## Managing Subscriptions

Control when derived collections start and stop syncing:

```typescript
const derivedCollection = createLiveQueryCollection({
  startSync: false, // Don't start automatically
  query: (q) => q.from({ todo: todoCollection }),
})

// Manually start the subscription
derivedCollection.startSync()

// Later, stop the subscription
derivedCollection.stopSync()

// Check sync status
if (derivedCollection.status === 'synced') {
  console.log('Derived collection is synced')
}
```

## Complete Example: Dashboard View

```typescript
import { createCollection } from '@tanstack/react-db'
import { createLiveQueryCollection, eq } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

// Source collections
const tasksCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['tasks'],
    queryFn: async () => api.tasks.getAll(),
    getKey: (item) => item.id,
  })
)

const usersCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['users'],
    queryFn: async () => api.users.getAll(),
    getKey: (item) => item.id,
  })
)

const projectsCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['projects'],
    queryFn: async () => api.projects.getAll(),
    getKey: (item) => item.id,
  })
)

// Derived collection: Active tasks with user and project info
export const dashboardTasksCollection = createLiveQueryCollection({
  startSync: true,
  query: (q) =>
    q.from({ task: tasksCollection })
      .join(
        { user: usersCollection },
        ({ task, user }) => eq(user.id, task.assignedTo),
        'left'
      )
      .join(
        { project: projectsCollection },
        ({ task, project }) => eq(project.id, task.projectId),
        'left'
      )
      .where(({ task }) => !task.completed)
      .select(({ task, user, project }) => ({
        id: task.id,
        title: task.title,
        dueDate: task.dueDate,
        priority: task.priority,
        assigneeName: user?.name || 'Unassigned',
        projectName: project?.name || 'No Project',
        projectColor: project?.color || '#gray',
      }))
      .orderBy(({ task }) => task.dueDate, 'asc'),
})

// Use in component
function DashboardTasks() {
  const { data: tasks } = useLiveQuery((q) =>
    q.from({ task: dashboardTasksCollection })
  )

  return (
    <div>
      <h2>Active Tasks</h2>
      {tasks.map((task) => (
        <div key={task.id} style={{ borderLeft: `4px solid ${task.projectColor}` }}>
          <h3>{task.title}</h3>
          <p>Assigned to: {task.assigneeName}</p>
          <p>Project: {task.projectName}</p>
          <p>Due: {task.dueDate}</p>
        </div>
      ))}
    </div>
  )
}
```

## Performance Benefits

Derived collections use [differential dataflow](https://github.com/electric-sql/d2ts) for incremental updates:

- **Fast updates**: When source data changes, only the affected parts of the derived collection update
- **Efficient joins**: Join operations update incrementally rather than re-computing the entire join
- **Low latency**: Updates typically complete in sub-millisecond time
- **Memory efficient**: Only materialized results are stored, not intermediate states

```typescript
// When a single todo is updated in the source collection,
// only that todo's entry in the derived collection updates
const activeTodos = createLiveQueryCollection({
  startSync: true,
  query: (q) =>
    q.from({ todo: todoCollection })
      .where(({ todo }) => !todo.completed)
      .orderBy(({ todo }) => todo.createdAt, 'desc'),
})

// This is blazing fast even with thousands of todos
todoCollection.update('todo-123', (draft) => {
  draft.title = 'Updated title'
})
```

## Querying Derived Collections

Derived collections are regular collections, so you can query them like any other collection:

```typescript
const completedTodos = createLiveQueryCollection({
  startSync: true,
  query: (q) =>
    q.from({ todo: todoCollection })
      .where(({ todo }) => todo.completed),
})

// Query the derived collection in a component
function CompletedTodosList() {
  const { data: todos } = useLiveQuery((q) =>
    q.from({ todo: completedTodos })
      .where(({ todo }) => todo.priority > 5)
      .orderBy(({ todo }) => todo.completedAt, 'desc')
  )

  return <List items={todos} />
}

// Or access data directly
const allCompleted = completedTodos.toArray()
```

## Use Cases

Derived collections are perfect for:
- Creating filtered views (active items, favorites, etc.)
- Denormalizing data (joining related collections)
- Computing aggregations (counts, sums, averages)
- Creating dashboard views
- Maintaining sorted/ordered views
- Implementing search results
- Building materialized views for complex queries

## When Not to Use

For these scenarios, consider alternatives:
- **One-time transformations**: Use regular `useLiveQuery` directly in components
- **Simple filtering in components**: Use `useLiveQuery` with where clauses
- **Server-side filtering**: Use collection where clauses in `ElectricCollection` or `QueryCollection`

## Learn More

- [Live Queries Guide](../guides/live-queries.md)
- [Query Collection](./query-collection.md)
- [Electric Collection](./electric-collection.md)
- [d2ts: Differential Dataflow](https://github.com/electric-sql/d2ts)
