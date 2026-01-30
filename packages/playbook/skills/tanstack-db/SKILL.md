---
name: tanstack-db
description: |
  TanStack DB patterns for reactive client-side data with live queries and optimistic mutations.
  Use for collections, queries, mutations, schemas, and sync engine integration.
---

# TanStack DB Skills

TanStack DB is the reactive client store for your API. It provides sub-millisecond live queries, instant optimistic updates, and seamless integration with REST APIs and sync engines like ElectricSQL.

## Routing Table

| Topic            | Directory       | When to Use                                                                                           |
| ---------------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| **Live Queries** | `live-queries/` | Querying data: filters, joins, aggregations, groupBy, orderBy, subqueries, reactive updates           |
| **Mutations**    | `mutations/`    | Writing data: insert/update/delete, optimistic updates, transactions, paced mutations, error handling |
| **Collections**  | `collections/`  | Data sources: overview, sync modes, local collections, choosing collection types                      |
| **Schemas**      | `schemas/`      | Validation: schema definition, TInput/TOutput types, transformations, defaults, error handling        |
| **Query**        | `query/`        | QueryCollection: REST API integration, TanStack Query, predicate push-down, refetch                   |
| **Electric**     | `electric/`     | ElectricCollection: ElectricSQL, shapes, txid matching, real-time Postgres sync                       |
| **PowerSync**    | `powersync/`    | PowerSyncCollection: offline-first, SQLite persistence, bidirectional sync                            |
| **RxDB**         | `rxdb/`         | RxDBCollection: RxDB integration, reactive local databases, storage backends                          |
| **TrailBase**    | `trailbase/`    | TrailBaseCollection: TrailBase backend, event subscriptions, type conversions                         |

## Quick Detection

**Route to `live-queries/` when:**

- Building queries with `useLiveQuery` or `createLiveQueryCollection`
- Using `from`, `where`, `select`, `join`, `groupBy`, `orderBy`
- Working with aggregations (`count`, `sum`, `avg`, `min`, `max`)
- Joining data across multiple collections
- Creating derived/materialized views
- Performance questions about query updates

**Route to `mutations/` when:**

- Using `collection.insert()`, `collection.update()`, `collection.delete()`
- Creating custom actions with `createOptimisticAction`
- Working with transactions via `createTransaction`
- Implementing paced mutations (debounce, throttle, queue)
- Handling mutation errors or rollbacks
- Questions about optimistic state lifecycle

**Route to `collections/` when:**

- Setting up a new collection
- Choosing between QueryCollection, ElectricCollection, LocalStorage, etc.
- Configuring sync modes (eager, on-demand, progressive)
- Understanding collection lifecycle
- Loading data from APIs or sync engines

**Route to `schemas/` when:**

- Defining schemas with Zod, Valibot, or other StandardSchema libraries
- Understanding TInput vs TOutput types
- Transforming data (string to Date, etc.)
- Setting default values
- Handling validation errors

**Route to `query/` when:**

- Using `queryCollectionOptions` with TanStack Query
- Integrating REST APIs with TanStack DB
- Configuring refetch, polling, or caching behavior
- Using on-demand sync mode with predicate push-down
- Monitoring query state (loading, error, refetching)

**Route to `electric/` when:**

- Setting up ElectricSQL integration
- Working with shapes and real-time sync
- Implementing txid matching for mutations
- Debugging sync issues
- Building an Electric proxy

**Route to `powersync/` when:**

- Using `powerSyncCollectionOptions`
- Building offline-first applications
- Working with SQLite persistence
- Handling PowerSync schema types
- Custom serialization/deserialization

**Route to `rxdb/` when:**

- Using `rxdbCollectionOptions`
- Working with RxDB databases and storage backends
- Setting up RxDB replication
- Migrating RxDB schemas

**Route to `trailbase/` when:**

- Using `trailBaseCollectionOptions`
- Integrating with TrailBase backend
- Working with event subscriptions
- Handling type conversions between app and server types

## Core Concepts

```tsx
import { createCollection, useLiveQuery, eq } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

// 1. Define a collection (data source)
const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then((r) => r.json()),
    getKey: (item) => item.id,
    onUpdate: async ({ transaction }) => {
      await api.todos.update(
        transaction.mutations[0].original.id,
        transaction.mutations[0].changes,
      )
    },
  }),
)

// 2. Query with live queries (reactive, incremental updates)
function TodoList() {
  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.completed, false))
      .orderBy(({ todo }) => todo.createdAt, 'desc'),
  )

  // 3. Mutate with optimistic updates
  const toggleTodo = (id: string) => {
    todoCollection.update(id, (draft) => {
      draft.completed = !draft.completed
    })
  }

  return (
    <ul>
      {todos?.map((todo) => (
        <li key={todo.id} onClick={() => toggleTodo(todo.id)}>
          {todo.text}
        </li>
      ))}
    </ul>
  )
}
```

## Data Flow

TanStack DB extends unidirectional data flow beyond the client:

```
┌─────────────────────────────────────────────────────────────┐
│                     OPTIMISTIC LOOP (instant)               │
│  User Action → Optimistic State → UI Update                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     PERSISTENCE LOOP (async)                │
│  Mutation Handler → Server → Sync Back → Confirmed State    │
└─────────────────────────────────────────────────────────────┘
```

## Package Overview

| Package                              | Purpose                                 |
| ------------------------------------ | --------------------------------------- |
| `@tanstack/db`                       | Core: collections, queries, mutations   |
| `@tanstack/react-db`                 | React hooks: useLiveQuery, etc.         |
| `@tanstack/query-db-collection`      | REST API integration via TanStack Query |
| `@tanstack/electric-db-collection`   | ElectricSQL real-time Postgres sync     |
| `@tanstack/powersync-db-collection`  | PowerSync offline-first SQLite sync     |
| `@tanstack/rxdb-db-collection`       | RxDB reactive local databases           |
| `@tanstack/trailbase-db-collection`  | TrailBase real-time backend             |
| `@tanstack/vue-db`                   | Vue adapter                             |
| `@tanstack/angular-db`               | Angular adapter                         |
| `@tanstack/svelte-db`                | Svelte adapter                          |
| `@tanstack/solid-db`                 | Solid adapter                           |
