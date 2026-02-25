---
title: Overview
id: overview
---

# TanStack DB - Documentation

Welcome to the TanStack DB documentation.

TanStack DB is the reactive client store for your API. It solves the problems of building fast, modern apps, helping you:

- avoid endpoint sprawl and network waterfalls by loading data into normalized collections
- optimise client performance with sub-millisecond live queries and real-time reactivity
- take the network off the interaction path with instant optimistic writes

Data loading is optimized. Interactions feel instantaneous. Your backend stays simple and your app stays blazing fast. No matter how much data you load.

## Remove the complexity from building fast, modern apps

TanStack DB lets you query your data however your components need it, with a blazing-fast local query engine, real-time reactivity and instant optimistic updates.

Instead of choosing between the least of two evils:

1. **view-specific APIs** - complicating your backend and leading to network waterfalls
2. **load everything and filter** - leading to slow loads and sluggish client performance

TanStack DB enables a new way:

3. **normalized collections** - keep your backend simple
4. **query-driven sync** - optimizes your data loading
5. **sub-millisecond live queries** - keep your app fast and responsive

It extends TanStack Query with collections, live queries and optimistic mutations, working seamlessly with REST APIs, sync engines, or any data source.

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
    q.from({ todo: todoCollection }).where(({ todo }) => eq(todo.completed, false))
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
- storing local data, for example [using localStorage for user preferences and settings](./collections/local-storage-collection.md) or [in-memory client data or UI state](./collections/local-only-collection.md)
- from live collection queries, creating [derived collections as materialised views](#using-live-queries)

Once you have your data in collections, you can query across them using live queries in your components.

#### Sync Modes

Collections support three sync modes to optimize data loading:

- **Eager mode** (default): Loads entire collection upfront. Best for <10k rows of mostly static data like user preferences or small reference tables.
- **On-demand mode**: Loads only what queries request. Best for large datasets (>50k rows), search interfaces, and catalogs where most data won't be accessed.
- **Progressive mode**: Loads query subset immediately, syncs full dataset in background. Best for collaborative apps needing instant first paint AND sub-millisecond queries.

With on-demand mode, your component's query becomes the API call:

```tsx
const productsCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['products'],
    queryFn: async (ctx) => {
      // Query predicates passed automatically in ctx.meta
      const params = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions)
      return api.getProducts(params) // e.g., GET /api/products?category=electronics&price_lt=100
    },
    syncMode: 'on-demand', // ← Enable query-driven sync
  })
)
```

TanStack DB automatically collapses duplicate requests, performs delta loading when expanding queries, optimizes joins into minimal batched requests, and respects your TanStack Query cache policies. You often end up with _fewer_ network requests than custom view-specific APIs.

See the [Query Collection documentation](./collections/query-collection.md#queryfn-and-predicate-push-down) for full predicate mapping details.

### Using live queries

Live queries are used to query data out of collections. Live queries are reactive: when the underlying data changes in a way that would affect the query result, the result is incrementally updated and returned from the query, triggering a re-render.

TanStack DB live queries are implemented using [d2ts](https://github.com/electric-sql/d2ts), a TypeScript implementation of differential dataflow. This allows the query results to update _incrementally_ (rather than by re-running the whole query). This makes them blazing fast, usually sub-millisecond, even for highly complex queries.

**Performance:** Updating one row in a sorted 100,000-item collection completes in ~0.7ms on an M1 Pro MacBook—fast enough that optimistic updates feel truly instantaneous, even with complex queries and large datasets.

Live queries support joins across collections. This allows you to:

1. load normalised data into collections and then de-normalise it through queries; simplifying your backend by avoiding the need for bespoke API endpoints that match your client
2. join data from multiple sources; for example, syncing some data out of a database, fetching some other data from an external API and then joining these into a unified data model for your front-end code

Every query returns another collection which can _also_ be queried.

For more details on live queries, see the [Live Queries](./guides/live-queries.md) documentation.

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

For more complex mutations, you can create custom actions with `createOptimisticAction` or custom transactions with `createTransaction`. See the [Mutations guide](./guides/mutations.md) for details.

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

- **[PowerSyncCollection](./collections/powersync-collection.md)** &mdash; Sync with PowerSync's SQLite-based database for offline-first persistence with real-time synchronization with PostgreSQL, MongoDB, and MySQL backends.

**Local Collections**

- **[LocalStorageCollection](./collections/local-storage-collection.md)** &mdash; Store small amounts of local-only state that persists across sessions and syncs across browser tabs.

- **[LocalOnlyCollection](./collections/local-only-collection.md)** &mdash; Manage in-memory client data or UI state that doesn't need persistence or cross-tab sync.

#### Collection Schemas

All collections optionally (though strongly recommended) support adding a `schema`.

If provided, this must be a [Standard Schema](https://standardschema.dev) compatible schema instance, such as [Zod](https://zod.dev), [Valibot](https://valibot.dev), [ArkType](https://arktype.io), or [Effect](https://effect.website/docs/schema/introduction/).

**What schemas do:**

1. **Runtime validation** - Ensures data meets your constraints before entering the collection
2. **Type transformations** - Convert input types to rich output types (e.g., string → Date)
3. **Default values** - Automatically populate missing fields
4. **Type safety** - Infer TypeScript types from your schema

**Example:**
```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean().default(false),
  created_at: z.string().transform(val => new Date(val)),  // string → Date
  priority: z.number().default(0)
})

const collection = createCollection(
  queryCollectionOptions({
    schema: todoSchema,
    // ...
  })
)

// Users provide simple inputs
collection.insert({
  id: "1",
  text: "Buy groceries",
  created_at: "2024-01-01T00:00:00Z"  // string
  // completed and priority filled automatically
})

// Collection stores and returns rich types
const todo = collection.get("1")
console.log(todo.created_at.getFullYear())  // It's a Date!
console.log(todo.completed)  // false (default)
```

The collection will use the schema for its type inference. If you provide a schema, you cannot also pass an explicit type parameter (e.g., `createCollection<Todo>()`).

**Learn more:** See the [Schemas guide](./guides/schemas.md) for comprehensive documentation on schema validation, type transformations, and best practices.

#### Creating Custom Collection Types

You can create your own collection types by implementing the `Collection` interface found in [`../packages/db/src/collection/index.ts`](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts).

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

#### `useLiveSuspenseQuery` hook

For React Suspense support, use `useLiveSuspenseQuery`. This hook suspends rendering during initial data load and guarantees that `data` is always defined:

```tsx
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { Suspense } from 'react'

const Todos = () => {
  // data is always defined - no need for optional chaining
  const { data: todos } = useLiveSuspenseQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.completed, false))
  )

  return <List items={ todos } />
}

const App = () => (
  <Suspense fallback={<div>Loading...</div>}>
    <Todos />
  </Suspense>
)
```

See the [React Suspense section in Live Queries](./guides/live-queries#using-with-react-suspense) for detailed usage patterns and when to use `useLiveSuspenseQuery` vs `useLiveQuery`.

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

See the [Live Queries](./guides/live-queries.md) documentation for more details.

### Transactional mutators

For more complex mutations beyond simple CRUD operations, TanStack DB provides `createOptimisticAction` and `createTransaction` for creating custom mutations with full control over the mutation lifecycle.

See the [Mutations guide](./guides/mutations.md) for comprehensive documentation on:

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

#### Why Sync Engines?

While TanStack DB works great with REST APIs, sync engines provide powerful benefits:

- **Easy real-time updates**: No WebSocket plumbing—write to your database and changes stream automatically to all clients
- **Automatic side-effects**: When a mutation triggers cascading changes across tables, all affected data syncs automatically without manual cache invalidation
- **Efficient delta updates**: Only changed rows cross the wire, making it practical to load large datasets client-side

This pattern enables the "load everything once" approach that makes apps like Linear and Figma feel instant.

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
