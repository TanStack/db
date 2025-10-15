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

There are a number of built-in collection types:

1. [`QueryCollection`](#querycollection) to load data into collections using [TanStack Query](https://tanstack.com/query)
2. [`ElectricCollection`](#electriccollection) to sync data into collections using [ElectricSQL](https://electric-sql.com)
3. [`TrailBaseCollection`](#trailbasecollection) to sync data into collections using [TrailBase](https://trailbase.io)
4. [`RxDBCollection`](#rxdbcollection) to integrate with [RxDB](https://rxdb.info) for local persistence and sync
5. [`LocalStorageCollection`](#localstoragecollection) for small amounts of local-only state that syncs across browser tabs
6. [`LocalOnlyCollection`](#localonlycollection) for in-memory client data or UI state

You can also use:

- use live collection queries to [derive collections from other collections](#derived-collections)
- the [base Collection](#base-collection) to define your own collection types

#### Collection schemas

All collections optionally (though strongly recommended) support adding a `schema`.

If provided, this must be a [Standard Schema](https://standardschema.dev) compatible schema instance, such as a [Zod](https://zod.dev) or [Effect](https://effect.website/docs/schema/introduction/) schema.

The collection will use the schema to do client-side validation of optimistic mutations.

The collection will use the schema for its type so if you provide a schema, you can't also pass in an explicit
type (e.g. `createCollection<Todo>()`).

#### `QueryCollection`

[TanStack Query](https://tanstack.com/query) fetches data using managed queries. Use `queryCollectionOptions` to fetch data into a collection using TanStack Query:

```ts
import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"

const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todoItems"],
    queryFn: async () => {
      const response = await fetch("/api/todos")
      return response.json()
    },
    getKey: (item) => item.id,
    schema: todoSchema, // any standard schema
  })
)
```

The collection will be populated with the query results.

#### `ElectricCollection`

[Electric](https://electric-sql.com) is a read-path sync engine for Postgres. It allows you to sync subsets of data out of a Postgres database, [through your API](https://electric-sql.com/blog/2024/11/21/local-first-with-your-existing-api), into a TanStack DB collection.

Electric's main primitive for sync is a [Shape](https://electric-sql.com/docs/guides/shapes). Use `electricCollectionOptions` to sync a shape into a collection:

```ts
import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"

export const todoCollection = createCollection(
  electricCollectionOptions({
    id: "todos",
    shapeOptions: {
      url: "https://example.com/v1/shape",
      params: {
        table: "todos",
      },
    },
    getKey: (item) => item.id,
    schema: todoSchema,
  })
)
```

The Electric collection requires two Electric-specific options:

- `shapeOptions` &mdash; the Electric [ShapeStreamOptions](https://electric-sql.com/docs/api/clients/typescript#options) that define the [Shape](https://electric-sql.com/docs/guides/shapes) to sync into the collection; this includes the
  - `url` to your sync engine; and
  - `params` to specify the `table` to sync and any optional `where` clauses, etc.
- `getKey` &mdash; identifies the id for the rows being synced into the collection

A new collections doesn't start syncing until you call `collection.preload()` or you query it.

Electric shapes allow you to filter data using where clauses:

```ts
export const myPendingTodos = createCollection(
  electricCollectionOptions({
    id: "todos",
    shapeOptions: {
      url: "https://example.com/v1/shape",
      params: {
        table: "todos",
        where: `
        status = 'pending'
        AND
        user_id = '${user.id}'
      `,
      },
    },
    getKey: (item) => item.id,
    schema: todoSchema,
  })
)
```

> [!TIP]
> Shape where clauses, used to filter the data you sync into `ElectricCollection`s, are different from the [live queries](#live-queries) you use to query data in components.
>
> Live queries are much more expressive than shapes, allowing you to query across collections, join, aggregate, etc. Shapes just contain filtered database tables and are used to populate the data in a collection.

If you need more control over what data syncs into the collection, Electric allows you to [use your API](https://electric-sql.com/blog/2024/11/21/local-first-with-your-existing-api#filtering) as a proxy to both authorize and filter data.

See the [Electric docs](https://electric-sql.com/docs/intro) for more information.

#### `TrailBaseCollection`

[TrailBase](https://trailbase.io) is an easy-to-self-host, single-executable application backend with built-in SQLite, a V8 JS runtime, auth, admin UIs and sync functionality.

TrailBase lets you expose tables via [Record APIs](https://trailbase.io/documentation/apis_record/) and subscribe to changes when `enable_subscriptions` is set. Use `trailBaseCollectionOptions` to sync records into a collection:

```ts
import { createCollection } from "@tanstack/react-db"
import { trailBaseCollectionOptions } from "@tanstack/trailbase-db-collection"
import { initClient } from "trailbase"

const trailBaseClient = initClient(`https://trailbase.io`)

export const todoCollection = createCollection<SelectTodo, Todo>(
  trailBaseCollectionOptions({
    id: "todos",
    recordApi: trailBaseClient.records(`todos`),
    getKey: (item) => item.id,
    schema: todoSchema,
    parse: {
      created_at: (ts) => new Date(ts * 1000),
    },
    serialize: {
      created_at: (date) => Math.floor(date.valueOf() / 1000),
    },
  })
)
```

This collection requires the following TrailBase-specific options:

- `recordApi` — identifies the API to sync.
- `getKey` — identifies the id for the records being synced into the collection.
- `parse` — maps `(v: Todo[k]) => SelectTodo[k]`.
- `serialize` — maps `(v: SelectTodo[k]) => Todo[k]`.

A new collections doesn't start syncing until you call `collection.preload()` or you query it.

#### `RxDBCollection`

[RxDB](https://rxdb.info) is a client-side database for JavaScript apps with replication, conflict resolution, and offline-first features.  
Use `rxdbCollectionOptions` from `@tanstack/rxdb-db-collection` to integrate an RxDB collection with TanStack DB:

```ts
import { createCollection } from "@tanstack/react-db"
import { rxdbCollectionOptions } from "@tanstack/rxdb-db-collection"
import { createRxDatabase } from "rxdb"

const db = await createRxDatabase({
  name: "mydb",
  storage: getRxStorageMemory(),
})
await db.addCollections({
  todos: {
    schema: {
      version: 0,
      primaryKey: "id",
      type: "object",
      properties: {
        id: { type: "string", maxLength: 100 },
        text: { type: "string" },
        completed: { type: "boolean" },
      },
    },
  },
})

// Wrap the RxDB collection with TanStack DB
export const todoCollection = createCollection(
  rxdbCollectionOptions({
    rxCollection: db.todos,
    startSync: true,
  })
)
```

With this integration:

- TanStack DB subscribes to RxDB's change streams and reflects updates, deletes, and inserts in real-time.
- You get local-first sync when RxDB replication is configured.
- Mutation handlers (onInsert, onUpdate, onDelete) are implemented using RxDB's APIs (bulkUpsert, incrementalPatch, bulkRemove).

This makes RxDB a great choice for apps that need local-first storage, replication, or peer-to-peer sync combined with TanStack DB's live queries and transaction lifecycle.

#### `LocalStorageCollection`

localStorage collections store small amounts of local-only state that persists across browser sessions and syncs across browser tabs in real-time. All data is stored under a single localStorage key and automatically synchronized using storage events.

Use `localStorageCollectionOptions` to create a collection that stores data in localStorage:

```ts
import { createCollection } from "@tanstack/react-db"
import { localStorageCollectionOptions } from "@tanstack/react-db"

export const userPreferencesCollection = createCollection(
  localStorageCollectionOptions({
    id: "user-preferences",
    storageKey: "app-user-prefs", // localStorage key
    getKey: (item) => item.id,
    schema: userPrefsSchema,
  })
)
```

The localStorage collection requires:

- `storageKey` — the localStorage key where all collection data is stored
- `getKey` — identifies the id for items in the collection

Mutation handlers (`onInsert`, `onUpdate`, `onDelete`) are completely optional. Data will persist to localStorage whether or not you provide handlers. You can provide alternative storage backends like `sessionStorage` or custom implementations that match the localStorage API.

```ts
export const sessionCollection = createCollection(
  localStorageCollectionOptions({
    id: "session-data",
    storageKey: "session-key",
    storage: sessionStorage, // Use sessionStorage instead
    getKey: (item) => item.id,
  })
)
```

> [!TIP]
> localStorage collections are perfect for user preferences, UI state, and other data that should persist locally but doesn't need server synchronization. For server-synchronized data, use [`QueryCollection`](#querycollection) or [`ElectricCollection`](#electriccollection) instead.

#### `LocalOnlyCollection`

LocalOnly collections are designed for in-memory client data or UI state that doesn't need to persist across browser sessions or sync across tabs. They provide a simple way to manage temporary, session-only data with full optimistic mutation support.

Use `localOnlyCollectionOptions` to create a collection that stores data only in memory:

```ts
import { createCollection } from "@tanstack/react-db"
import { localOnlyCollectionOptions } from "@tanstack/react-db"

export const uiStateCollection = createCollection(
  localOnlyCollectionOptions({
    id: "ui-state",
    getKey: (item) => item.id,
    schema: uiStateSchema,
    // Optional initial data to populate the collection
    initialData: [
      { id: "sidebar", isOpen: false },
      { id: "theme", mode: "light" },
    ],
  })
)
```

The LocalOnly collection requires:

- `getKey` — identifies the id for items in the collection

Optional configuration:

- `initialData` — array of items to populate the collection with on creation
- `onInsert`, `onUpdate`, `onDelete` — optional mutation handlers for custom logic

Mutation handlers are completely optional. When provided, they are called before the optimistic state is confirmed. The collection automatically manages the transition from optimistic to confirmed state internally.

```ts
export const tempDataCollection = createCollection(
  localOnlyCollectionOptions({
    id: "temp-data",
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      // Custom logic before confirming the insert
      console.log("Inserting:", transaction.mutations[0].modified)
    },
    onUpdate: async ({ transaction }) => {
      // Custom logic before confirming the update
      const { original, modified } = transaction.mutations[0]
      console.log("Updating from", original, "to", modified)
    },
  })
)
```

> [!TIP]
> LocalOnly collections are perfect for temporary UI state, form data, or any client-side data that doesn't need persistence. For data that should persist across sessions, use [`LocalStorageCollection`](#localstoragecollection) instead.

**Using LocalStorage and LocalOnly Collections with Manual Transactions:**

When using either LocalStorage or LocalOnly collections with manual transactions (created via `createTransaction`), you must call `utils.acceptMutations()` in your transaction's `mutationFn` to persist the changes. This is necessary because these collections don't participate in the standard mutation handler flow for manual transactions.

```ts
import { createTransaction } from "@tanstack/react-db"

const localData = createCollection(
  localOnlyCollectionOptions({
    id: "form-draft",
    getKey: (item) => item.id,
  })
)

const serverCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["items"],
    queryFn: async () => api.items.getAll(),
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      await api.items.create(transaction.mutations[0].modified)
    },
  })
)

const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Server collection mutations are handled by their onInsert handler automatically
    // (onInsert will be called and awaited)

    // After server mutations succeed, persist local collection mutations
    localData.utils.acceptMutations(transaction)
  },
})

// Apply mutations to both collections in one transaction
tx.mutate(() => {
  localData.insert({ id: "draft-1", data: "..." })
  serverCollection.insert({ id: "1", name: "Item" })
})

await tx.commit()
```

#### Derived collections

Live queries return collections. This allows you to derive collections from other collections.

For example:

```ts
import { createLiveQueryCollection, eq } from "@tanstack/db"

// Imagine you have a collection of todos.
const todoCollection = createCollection({
  // config
})

// You can derive a new collection that's a subset of it.
const completedTodoCollection = createLiveQueryCollection({
  startSync: true,
  query: (q) =>
    q.from({ todo: todoCollection }).where(({ todo }) => todo.completed),
})
```

This also works with joins to derive collections from multiple source collections. And it works recursively -- you can derive collections from other derived collections. Changes propagate efficiently using differential dataflow and it's collections all the way down.

#### Collection

There is a `Collection` interface in [`../packages/db/src/collection.ts`](https://github.com/TanStack/db/blob/main/packages/db/src/collection.ts). You can use this to implement your own collection types.

See the existing implementations in [`../packages/db`](https://github.com/TanStack/db/tree/main/packages/db), [`../packages/query-db-collection`](https://github.com/TanStack/db/tree/main/packages/query-db-collection), [`../packages/electric-db-collection`](https://github.com/TanStack/db/tree/main/packages/electric-db-collection) and [`../packages/trailbase-db-collection`](https://github.com/TanStack/db/tree/main/packages/trailbase-db-collection) for reference.

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
2. [using the ElectricSQL sync engine](#2-electricsql-sync) with a generic ingestion endpoint

> [!TIP]
> You can combine these patterns. One of the benefits of TanStack DB is that you can integrate different ways of loading data and handling mutations into the same app. Your components don't need to know where the data came from or goes.

### 1. TanStack Query

You can use TanStack DB with your existing REST API via TanStack Query.

The steps are to:

1. create [`QueryCollection`](#querycollection)s that load data using TanStack Query
2. implement [`mutationFn`](#mutationfn)s that handle mutations by posting them to your API endpoints

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
