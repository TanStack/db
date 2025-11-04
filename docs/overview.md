---
title: Overview
id: overview
---

# TanStack DB - Documentation

Welcome to the TanStack DB documentation.

TanStack DB is a reactive client store for building super fast apps on sync. It extends TanStack Query with collections, live queries and optimistic mutations.

## Contents

- [How it works](#how-it-works) &mdash; understand the TanStack DB development model and how the pieces fit together
- [API reference](#api-reference) &mdash; for the primitives and function interfaces
- [Usage examples](#usage-examples) &mdash; examples of common usage patterns
- [More info](#more-info) &mdash; where to find support and more information

## How it works

TanStack DB works by:

- [defining collections](#defining-collections) typed sets of objects that can be populated with data
- [using live queries](#using-live-queries) to query data from/across collections
- [making optimistic mutations](#making-optimistic-mutations) using transactional mutators

```tsx
// Define collections to load data into
const todoCollection = createCollection({
  // ...your config
  onUpdate: updateMutationFn,
})

const Todos = () => {
  // Bind data using live queries
  const { data: todos } = useLiveQuery((q) =>
    q.from({ todo: todoCollection }).where(({ todo }) => todo.completed)
  )

  const complete = (todo) => {
    // Instantly applies optimistic state
    todoCollection.update(todo.id, (draft) => {
      draft.completed = true
    })
  }

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id} onClick={() => complete(todo)}>
          {todo.text}
        </li>
      ))}
    </ul>
  )
}
```

### Defining collections

Collections are typed sets of objects that can be populated with data. They're designed to de-couple loading data into your app from binding data to your components.

Collections can be populated in many ways, including:

- fetching data, for example [from API endpoints using TanStack Query](https://tanstack.com/query/latest)
- syncing data, for example [using a sync engine like ElectricSQL](https://electric-sql.com/)
- storing local data, for example [using localStorage for user preferences and settings](#localstoragecollection) or [in-memory client data or UI state](#localonlycollection)
- from live collection queries, creating [derived collections as materialised views](#using-live-queries)

Once you have your data in collections, you can query across them using live queries in your components.

### Using live queries

Live queries are used to query data out of collections. Live queries are reactive: when the underlying data changes in a way that would affect the query result, the result is incrementally updated and returned from the query, triggering a re-render.

TanStack DB live queries are implemented using [d2ts](https://github.com/electric-sql/d2ts), a Typescript implementation of differential dataflow. This allows the query results to update _incrementally_ (rather than by re-running the whole query). This makes them blazing fast, usually sub-millisecond, even for highly complex queries.

Live queries support joins across collections. This allows you to:

1. load normalised data into collections and then de-normalise it through queries; simplifying your backend by avoiding the need for bespoke API endpoints that match your client
2. join data from multiple sources; for example, syncing some data out of a database, fetching some other data from an external API and then joining these into a unified data model for your front-end code

Every query returns another collection which can _also_ be queried.

For more details on live queries, see the [Live Queries](../guides/live-queries.md) documentation.

### Making optimistic mutations

Collections support `insert`, `update` and `delete` operations. When called, by default they trigger the corresponding `onInsert`, `onUpdate`, `onDelete` handlers which are responsible for writing the mutation to the backend.

```ts
// Define collection with persistence handlers
const todoCollection = createCollection({
  id: "todos",
  // ... other config
  onUpdate: async ({ transaction }) => {
    const { original, changes } = transaction.mutations[0]
    await api.todos.update(original.id, changes)
  },
})

// Immediately applies optimistic state
todoCollection.update(todo.id, (draft) => {
  draft.completed = true
})
```

The collection maintains optimistic state separately from synced data. When live queries read from the collection, they see a local view that overlays the optimistic mutations on top of the immutable synced data.

The optimistic state is held until the handler resolves, at which point the data is persisted to the server and synced back. If the handler throws an error, the optimistic state is rolled back.

For more complex mutations, you can create custom actions with `createOptimisticAction` or custom transactions with `createTransaction`. See the [Mutations guide](../guides/mutations.md) for details.

### Uni-directional data flow

This combines to support a model of uni-directional data flow, extending the redux/flux style state management pattern beyond the client, to take in the server as well:

<figure>
  <a href="https://raw.githubusercontent.com/TanStack/db/main/docs/unidirectional-data-flow.lg.png" target="_blank">
    <img src="https://raw.githubusercontent.com/TanStack/db/main/docs/unidirectional-data-flow.png" />
  </a>
</figure>

With an instant inner loop of optimistic state, superseded in time by the slower outer loop of persisting to the server and syncing the updated server state back into the collection.

## API reference

### Collections

TanStack DB provides several built-in collection types for different data sources and use cases. Each collection type has its own detailed documentation page:

#### Built-in Collection Types

**Fetch Collections**

- **[QueryCollection](./collections/query-collection.md)** &mdash; Load data into collections using TanStack Query for REST APIs and data fetching.

**Sync Collections**

- **[ElectricCollection](./collections/electric-collection.md)** &mdash; Sync data into collections from Postgres using ElectricSQL's real-time sync engine.

- **[TrailBaseCollection](./collections/trailbase-collection.md)** &mdash; Sync data into collections using TrailBase's self-hosted backend with real-time subscriptions.

- **[RxDBCollection](./collections/rxdb-collection.md)** &mdash; Integrate with RxDB for offline-first local persistence with powerful replication and sync capabilities.

**Local Collections**

- **[LocalStorageCollection](./collections/local-storage-collection.md)** &mdash; Store small amounts of local-only state that persists across sessions and syncs across browser tabs.

- **[LocalOnlyCollection](./collections/local-only-collection.md)** &mdash; Manage in-memory client data or UI state that doesn't need persistence or cross-tab sync.

#### Collection Schemas

All collections optionally (though strongly recommended) support adding a `schema`.

If provided, this must be a [Standard Schema](https://standardschema.dev) compatible schema instance, such as a [Zod](https://zod.dev) or [Effect](https://effect.website/docs/schema/introduction/) schema.

The collection will use the schema to do client-side validation of optimistic mutations.

The collection will use the schema for its type so if you provide a schema, you can't also pass in an explicit
type (e.g. `createCollection<Todo>()`).

#### Creating Custom Collection Types

You can create your own collection types by implementing the `Collection` interface found in [`../packages/db/src/collection.ts`](https://github.com/TanStack/db/blob/main/packages/db/src/collection.ts).

See the existing implementations in [`../packages/db`](https://github.com/TanStack/db/tree/main/packages/db), [`../packages/query-db-collection`](https://github.com/TanStack/db/tree/main/packages/query-db-collection), [`../packages/electric-db-collection`](https://github.com/TanStack/db/tree/main/packages/electric-db-collection) and [`../packages/trailbase-db-collection`](https://github.com/TanStack/db/tree/main/packages/trailbase-db-collection) for reference. Also see the [Collection Options Creator guide](./guides/collection-options-creator.md) for a pattern to create reusable collection configuration factories.

### Live queries

#### `useLiveQuery` hook

Use the `useLiveQuery` hook to assign live query results to a state variable in your React components:

```ts
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'

const Todos = () => {
  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.completed, false))
      .orderBy(({ todo }) => todo.created_at, 'asc')
      .select(({ todo }) => ({
        id: todo.id,
        text: todo.text
      }))
  )

  return <List items={ todos } />
}
```

You can also query across collections with joins:

```ts
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'

const Todos = () => {
  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todos: todoCollection })
      .join(
        { lists: listCollection },
        ({ todos, lists }) => eq(lists.id, todos.listId),
        'inner'
      )
      .where(({ lists }) => eq(lists.active, true))
      .select(({ todos, lists }) => ({
        id: todos.id,
        title: todos.title,
        listName: lists.name
      }))
  )

  return <List items={ todos } />
}
```

#### `queryBuilder`

You can also build queries directly (outside of the component lifecycle) using the underlying `queryBuilder` API:

```ts
import { createLiveQueryCollection, eq } from "@tanstack/db"

const completedTodos = createLiveQueryCollection({
  startSync: true,
  query: (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.completed, true)),
})

const results = completedTodos.toArray
```

Note also that:

1. the query results [are themselves a collection](#derived-collections)
2. the `useLiveQuery` automatically starts and stops live query subscriptions when you mount and unmount your components; if you're creating queries manually, you need to manually manage the subscription lifecycle yourself

See the [Live Queries](../guides/live-queries.md) documentation for more details.

### Transactional mutators

For more complex mutations beyond simple CRUD operations, TanStack DB provides `createOptimisticAction` and `createTransaction` for creating custom mutations with full control over the mutation lifecycle.

See the [Mutations guide](../guides/mutations.md) for comprehensive documentation on:

- Creating custom actions with `createOptimisticAction`
- Manual transactions with `createTransaction`
- Mutation merging behavior
- Controlling optimistic vs non-optimistic updates
- Handling temporary IDs
- Transaction lifecycle states

## Usage examples

Here we illustrate two common ways of using TanStack DB:

1. [using TanStack Query](#1-tanstack-query) with an existing REST API
2. [using the ElectricSQL sync engine](#2-electricsql-sync) for real-time sync with your existing API

> [!TIP]
> You can combine these patterns. One of the benefits of TanStack DB is that you can integrate different ways of loading data and handling mutations into the same app. Your components don't need to know where the data came from or goes.

### 1. TanStack Query

You can use TanStack DB with your existing REST API via TanStack Query.

The steps are to:

1. create [QueryCollection](./collections/query-collection.md)s that load data using TanStack Query
2. implement mutation handlers that handle mutations by posting them to your API endpoints

```tsx
import { useLiveQuery, createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"

// Load data into collections using TanStack Query.
// It's common to define these in a `collections` module.
const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: async () => fetch("/api/todos"),
    getKey: (item) => item.id,
    schema: todoSchema, // any standard schema
    onInsert: async ({ transaction }) => {
      const { changes: newTodo } = transaction.mutations[0]

      // Handle the local write by sending it to your API.
      await api.todos.create(newTodo)
    },
    // also add onUpdate, onDelete as needed.
  })
)
const listCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todo-lists"],
    queryFn: async () => fetch("/api/todo-lists"),
    getKey: (item) => item.id,
    schema: todoListSchema,
    onInsert: async ({ transaction }) => {
      const { changes: newTodo } = transaction.mutations[0]

      // Handle the local write by sending it to your API.
      await api.todoLists.create(newTodo)
    },
    // also add onUpdate, onDelete as needed.
  })
)

const Todos = () => {
  // Read the data using live queries. Here we show a live
  // query that joins across two collections.
  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .join(
        { list: listCollection },
        ({ todo, list }) => eq(list.id, todo.list_id),
        "inner"
      )
      .where(({ list }) => eq(list.active, true))
      .select(({ todo, list }) => ({
        id: todo.id,
        text: todo.text,
        status: todo.status,
        listName: list.name,
      }))
  )

  // ...
}
```

This pattern allows you to extend an existing TanStack Query application, or any application built on a REST API, with blazing fast, cross-collection live queries and local optimistic mutations with automatically managed optimistic state.

### 2. ElectricSQL sync

One of the most powerful ways of using TanStack DB is with a sync engine, for a fully local-first experience with real-time sync. This allows you to incrementally adopt sync into an existing app, whilst still handling writes with your existing API.

Here, we illustrate this pattern using [ElectricSQL](https://electric-sql.com) as the sync engine.

```tsx
import type { Collection } from "@tanstack/db"
import type {
  MutationFn,
  PendingMutation,
  createCollection,
} from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"

export const todoCollection = createCollection(
  electricCollectionOptions({
    id: "todos",
    schema: todoSchema,
    // Electric syncs data using "shapes". These are filtered views
    // on database tables that Electric keeps in sync for you.
    shapeOptions: {
      url: "https://api.electric-sql.cloud/v1/shape",
      params: {
        table: "todos",
      },
    },
    getKey: (item) => item.id,
    schema: todoSchema,
    onInsert: async ({ transaction }) => {
      const response = await api.todos.create(transaction.mutations[0].modified)

      return { txid: response.txid }
    },
    // You can also implement onUpdate, onDelete as needed.
  })
)

const AddTodo = () => {
  return (
    <Button
      onClick={() => todoCollection.insert({ text: "🔥 Make app faster" })}
    />
  )
}
```

## React Native

When using TanStack DB with React Native, you need to install and configure a UUID generation library since React Native doesn't include crypto.randomUUID() by default.

Install the `react-native-random-uuid` package:

```bash
npm install react-native-random-uuid
```

Then import it at the entry point of your React Native app (e.g., in your `App.js` or `index.js`):

```javascript
import "react-native-random-uuid"
```

This polyfill provides the `crypto.randomUUID()` function that TanStack DB uses internally for generating unique identifiers.

## More info

If you have questions / need help using TanStack DB, let us know on the Discord or start a GitHub discussion:

- [`#db` channel in the TanStack discord](https://discord.gg/yjUNbvbraC)
- [GitHub discussions](https://github.com/tanstack/db/discussions)
