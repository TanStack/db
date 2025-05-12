
# TanStack DB - Documentation

Welcome to the TanStack DB documentation.

TanStack DB is a reactive client store for building super fast apps on sync. It extends TanStack Query with collections, live queries and transactional mutators.

## Contents

- [How it works](#how-it-works) &mdash; understand the TanStack DB development model and how the pieces fit together
- [Usage examples](#usage-examples) &mdash; examples of common usage patterns
- [API reference](#api-reference) &mdash; for the primitives and function interfaces
- [More info](#more-info) &mdash; where to find support and more information

## How it works

TanStack DB works by:

- [defining collections](#defining-collections) typed sets of objects that can be populated with data
- [using live queries](#using-live-queries) to query data from/across collections and bind it to your components
- [making local writes](#making-local-writes) with transactional mutators that manage optimistic state and background sync

```tsx
// Define collections to load data into
const todoCollection = createCollection({
  // your config
})

const Todos = () => {
  // Bind data using live queries
  const { data: todos } = useLiveQuery((query) =>
    query
      .from({ todoCollection })
      .where('@completed', '=', false)
  )

  // Make local writes using transactional mutators
  const updateTodo = useOptimisticMutation({ mutationFn })
  const complete = (todo) =>
    // Invokes the mutationFn to handle the write
    updateTodo.mutate(() =>
      // Instantly applies optimistic state
      todoCollection.update(todo, (draft) => {
        draft.completed = true
      })
    )

  return (
    <ul>
      {todos.map(todo =>
        <li key={ todo.id } onClick={() => complete(todo) }>
          { todo.text }
        </li>
      )}
    </ul>
  )
}
```

### Defining collections

Collections are typed sets of objects that can be populated with data. They're designed to de-couple loading data into your app from binding data to your components.

Collections can be populated in many ways, including:

- fetching data, for example [from API endpoints using TanStack Query](#)
- syncing data, for example [using a sync engine like ElectricSQL](#)
- storing local data, for example [in-memory client data or UI state](#)

Once you have your data in collections, you can query across them to bind results to your components.

### Using live queries

Live queries are used to query data out of collections and bind the results to state variables in your components. Live queries are reactive: when the underlying data changes in a way that would affect the query result, the new result is automatically assigned to the state variable, triggering a re-render.

TanStack DB live queries are implemented using [d2ts](https://github.com/electric-sql/d2ts), a Typescript implementation of differential dataflow. This allows the query results to update *incrementally* (rather than by re-running the whole query). This makes them blazing fast, usually sub-millisecond, even for highly complex queries.

Live queries support joins across collections. This allows you to:

1. load normalised data into collections and then de-normalise it through queries; simplifying your backend by avoiding the need for bespoke API endpoints that match your client
2. join data from multiple sources; for example, syncing some data out of a database, fetching some other data from an external API and then joining these into a unified data model for your front-end code

### Making local writes

Collections support `insert`, `update` and `delete` operations. These operations must be made within the context of a transactional mutator:

```ts
const updateTodo = useOptimisticMutation({ mutationFn })

// Triggers the `mutationFn`
updateTodo.mutate(() =>
  // Immediately applies optimistic state
  todoCollection.update(todo, (draft) => {
    draft.completed = true
  })
)
```

Rather than mutating the collection data directly, the collection internally treats its synced/loaded data as immutable and maintains a seperate set of local mutations as optimistic state. When live queries read from the collection, they see a local view that overlays the local optimistic mutations on-top-of the immutable synced data.

In addition, the local mutations are passed to the async `mutationFn` that's passed in when creating the mutator. This mutationFn is responsible for handling the writes, usually by sending them to a server or a database. TanStack DB waits for the function to resolve before then removing the optimistic state that was applied when the local writes was made.

For example, in the following code, the mutationFn first sends the write to the server using `await api.todos.update(updatedTodo)` and then calls `await collection.invalidate()` to trigger a re-fetch of the collection contents using TanStack Query. When this second await resolves, the collection is up-to-date with the latest changes and the optimistic state is safely discarded.

```ts
const updateTodo = useOptimisticMutation({
  mutationFn: async ({ transaction }) => {
    const { collection, modified: updatedTodo } = transaction.mutations[0]!

    await api.todos.update(updatedTodo)
    await collection.invalidate()
  },
})
```

### Uni-directional data flow

This combines to support a model of uni-directional data flow, extending the redux/flux style state management pattern beyond the client, to take in the server as well:

<figure>
  <a href="./unidirectional-data-flow.lg.png" target="_blank">
    <img src="./unidirectional-data-flow.png" />
  </a>
</figure>

## API reference

- [Collections](#collections) define and sync data into collections
- [Live queries](#live-queries) bind live queries to your components
- [Transactional mutators](#transactions) allow you to make and handle local mutations

### Collections

There are currently two built-in collection types (implemented in [`../packages/db-collections`](../packages/db-collections)):

1. [`QueryCollection`](#querycollection) to load data into collections using [TanStack Query](https://tanstack.com/query)
2. [`ElectricCollection`](#electriccollection) to sync data into collections using [ElectricSQL](https://electric-sql.com)

You can also use the [base Collection](#base-collection) to define your own collection types.

#### QueryCollection

[TanStack Query](https://tanstack.com/query) fetches data using managed queries. Use `createQueryCollection` to fetch data into a collection using TanStack Query:

```ts
const todoCollection = createQueryCollection({
  queryKey: ['todoItems'],
  queryFn: async () => fetch('/api/todos'),
  getPrimaryKey: (item) => item.id
})
```

The collection will be populated with the query results.

#### ElectricCollection

[Electric](https://electric-sql.com) is a read-path sync engine for Postgres. It allows you to sync subsets of data out of a Postgres database, [through your API](https://electric-sql.com/blog/2024/11/21/local-first-with-your-existing-api), into a TanStack DB collection.

Electric's main primitive for sync is a [Shape](https://electric-sql.com/docs/guides/shapes). Use `createElectricCollection` to sync a shape into a collection:

```ts
import { createElectricCollection } from '@tanstack/db-collections'

export const todoCollection = createElectricCollection<Todo>({
  id: 'todos',
  schema: todoSchema,
  streamOptions: {
    url: 'https://example.com/v1/shape',
    params: {
      table: 'todos'
    }
  },
  primaryKey: ['id']
})
```

All collections:

- require an `id` &mdash; this should be unique to your application
- optionally support a `schema` &mdash; if provided, this should be a [Standard Schema](https://standardschema.dev) compatible schema instance, such as a [Zod](https://zod.dev) or [Effect](https://effect.website/docs/schema/introduction/) schema

The Electric collection then also requires two additional options:

- `streamOptions` &mdash; the Electric [ShapeStreamOptions](https://electric-sql.com/docs/api/clients/typescript#options) that define the [Shape](https://electric-sql.com/docs/guides/shapes) to sync into the collection; this includes the
  - `url` to your sync engine; and
  - `params` to specify the `table` to sync and any optional `where` clauses, etc.
- `primaryKey` &mdash; identifies the primary key for the rows being synced into the collection

When you create the collection, sync starts automatically.

Electric shapes allow you to filter data using where clauses:

```ts
export const myPendingTodos = createElectricCollection<Todo>({
  id: 'todos',
  schema: todoSchema,
  streamOptions: {
    url: 'https://example.com/v1/shape',
    params: {
      table: 'todos',
      where: `
        status = 'pending'
        AND
        user_id = '${user.id}'
      `
    }
  },
  primaryKey: ['id']
})
```

> [!TIP]
> Shape where clauses, used to filter the data you sync into `ElectricCollection`s, are different from the [live queries](#live-queries) you use to bind data to components.
>
> Live queries are much more expressive than shapes, allowing you to query across collections, join, aggregate, etc. This allows you to de-normalise the data you bind to a component.
>
> Shapes are normalised: they just contain filtered database tables and are used to populate the data in a collection.

If you need more control over what data syncs into the collection, Electric allows you to [use your API](https://electric-sql.com/blog/2024/11/21/local-first-with-your-existing-api#filtering) as a proxy to both authorise and filter data.

See the [Electric docs](https://electric-sql.com/docs/intro) for more information.

#### base Collection

There is a base `Collection` class in [`../packages/db/src/collection.ts`](../packages/db/src/collection.ts). You can use this directly or as a base class for implementing your own collection types.

See the existing implementations in [`../packages/db-collections`](../packages/db-collections) for reference.

### Live queries

#### `useLiveQuery` hook

Use the `useLiveQuery` hook to bind data to React components:

```ts
import { useLiveQuery } from '@tanstack/react-db'

const Todos = () => {
  const { data: todos } = useLiveQuery(query =>
    query
      .from({ todoCollection })
      .where('@completed', '=', false)
      .orderBy({'@created_at': 'asc'})
      .select('@id', '@text')
      .keyBy('@id')
  )

  return <List items={ todos } />
}
```

You can also query across collections with joins:

```ts
import { useLiveQuery } from '@tanstack/react-db'

const Todos = () => {
  const { data: todos } = useLiveQuery(query =>
    query
      .from({ todos: todoCollection })
      .join({
        type: `inner`,
        from: { lists: listCollection },
        on: [`@lists.id`, `=`, `@todos.listId`],
      })
      .where('@lists.active', '=', true)
      .select(`@todos.id`, `@todos.title`, `@lists.name`)
      .keyBy('@id')
  )

  return <List items={ todos } />
}
```

See the [query-builder tests](../packages/db/tests/query/query-builder) for more usage examples.

### Transactional mutators

Transactions allow you to:

- batch and stage local changes across collections with immediate application of local optimistic updates
- sync to the backend using flexible mutationFns with automatic rollbacks and management of optimistic state

#### mutationFn

Transactions are created with a `mutationFn`. You can define a single, generic `mutationFn` for your whole app. Or you can define collection or mutation specific functions.

The `mutationFn` is responsible for handling the local changes and processing them, usually to send them to a server or database to be stored.

For example, this is a generic function that POSTs mutations to the server:

```tsx
import type { Collection } from '@tanstack/db'
import type { MutationFn, PendingMutation } from '@tanstack/react-db'

const filterOutCollection = (mutation: PendingMutation) => {
  const { collection: _, ...rest } = mutation

  return rest
}

const mutationFn: MutationFn = async ({ transaction }) => {
  const payload = transaction.mutations.map(filterOutCollection)
  const response = await fetch('https://api.example.com', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    // Throwing an error will rollback the optimistic state.
    throw new Error(`HTTP Error: ${response.status}`)
  }

  const result = await response.json()

  // Wait for the transaction to be synced back from the server
  // before discarding the optimistic state.
  const collection: Collection = transaction.mutations[0]!.collection
  await collection.config.sync.awaitTxid(result.txid)
}
```

The key requirments for the server, in this case are:

1. to be able to parse and ingest the payload format
2. to return the database transaction ID that the changes were applied under; this then allows the mutationFn to monitor the replication stream for that `txid`, at which point the local optimistic state is discarded

#### useOptimisticMutation

Use the `useOptimisticMutation` hook to create transactions in your components:

```tsx
import { useOptimisticMutation } from '@tanstack/react-db'

const AddTodo = () => {
  const tx = useOptimisticMutation({ mutationFn })

  const addTodo = () => {
    // Triggers the mutationFn to sync data in the background.
    tx.mutate(() =>
      // Instantly applies the local optimistic state.
      todoCollection.insert({
        id: uuid(),
        text: '🔥 Make app faster',
        completed: false
      })
    )
  }

  return <Button onClick={ addTodo } />
}
```

Transactions progress through the following states:

1. `pending`: Initial state when a transaction is created
2. `persisting`: Transaction is being persisted to the backend
3. `completed`: Transaction has been successfully persisted
4. `failed`: An error was thrown while persisting or syncing back the Transaction

#### Write operations

##### Insert

```typescript
// Insert a single item
insert({ text: "Buy groceries", completed: false })

// Insert multiple items
insert([
  { text: "Buy groceries", completed: false },
  { text: "Walk dog", completed: false },
])

// Insert with custom key
insert({ text: "Buy groceries" }, { key: "grocery-task" })
```

##### Update

We use a proxy to capture updates as immutable draft optimistic updates.

```typescript
// Update a single item
update(todo, (draft) => {
  draft.completed = true
})

// Update multiple items
update([todo1, todo2], (drafts) => {
  drafts.forEach((draft) => {
    draft.completed = true
  })
})

// Update with metadata
update(todo, { metadata: { reason: "user update" } }, (draft) => {
  draft.text = "Updated text"
})
```

##### Delete

```typescript
// Delete a single item
delete todo

// Delete multiple items
delete [todo1, todo2]

// Delete with metadata
delete (todo, { metadata: { reason: "completed" } })
```
