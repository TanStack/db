
# TanStack DB - Usage

- [Collections](#collections) define and sync data into collections
- [Live Queries](#live-queries) bind live queries to your components
- [Transactions](#transactions) allow you to make and handle local mutations


## Collections

Collections are typed sets of objects that can be populated with data.

There are currently two built-in collection types (implemented in [`../packages/db-collections`](../packages/db-collections)):

1. [`ElectricCollection`](#electriccollection) to sync data into collections using [ElectricSQL](https://electric-sql.com)
2. [`QueryCollection`](#querycollection) to load data into collections using [TanStack Query](https://tanstack.com/query)

You can also use the [base Collection](#base-collection) to define your own collection types.

### ElectricCollection

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
> TanStack DB de-couples the data you sync into a collection from the data you bind to a component. Shape where clauses are used to filter the data you sync into collections. [Live queries](#live-queries) are used to bind data to components.
>
> Live queries are much more expressive than shapes, allowing you to query across collections, join, aggregate, etc. This allows you to de-normalise the data you bind to a component.
>
> Shapes are normalised: they just contain filtered database tables.

If you need more control over what data syncs into the collection, Electric allows you to [use your API](https://electric-sql.com/blog/2024/11/21/local-first-with-your-existing-api#filtering) as a proxy to both authorise and filter data.

See the [Electric docs](https://electric-sql.com/docs/intro) for more information.

### QueryCollection

[TanStack Query](https://tanstack.com/query) fetches data using managed queries. Use `createQueryCollection` to fetch data into a collection using TanStack Query:

```ts
const todoCollection = createQueryCollection({
  queryKey: ['todoItems'],
  queryFn: async () => fetch('/api/todos'),
  getPrimaryKey: (item) => item.id
})
```

The collection will be populated with the query results.

### base Collection

There is a base `Collection` class in [`../packages/optimistic/src/collection.ts`](../packages/optimistic/src/collection.ts). You can use this directly or as a base class for implementing your own collection types.

See the existing implementations in [`../packages/db-collections`](../packages/db-collections) for reference.


## Live Queries

Live queries are used to query data out of [Collections](#collections) and bind the query results to state variables in your components.

Live queries are reactive: when the underlying data changes, the new result is automatically assigned to the state variable, triggering a re-render.

TanStack DB live queries are implemented using [d2ts](https://github.com/electric-sql/d2ts), a Typescript implementation of differential dataflow. This allows the query results to update incrementally (rather than by re-running the whole query). This makes them blazing fast, usually sub-millisecond.

### `useLiveQuery` hook

Use the `useLiveQuery` hook to bind data to React components:

```ts
import { useLiveQuery } from '@tanstack/react-optimistic'

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
import { useLiveQuery } from '@tanstack/react-optimistic'

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

See the [query-builder tests](../packages/optimistic/tests/query/query-builder) for more usage examples.


## Transactions

Transactions allow you to:

- batch and stage local changes across collections with immediate application of local optimistic updates
- sync to the backend using flexible mutationFns with automatic rollbacks and management of optimistic state

### mutationFn

Transactions are created with a `mutationFn`. You can define a single, generic `mutationFn` for your whole app. Or you can define collection or mutation specific functions.

The `mutationFn` is responsible for handling the local changes and processing them, usually to send them to a server or database to be stored.

For example, this is a generic function that POSTs mutations to the server:

```tsx
import type { Collection } from '@tanstack/optimistic'
import type { MutationFn, PendingMutation } from '@tanstack/react-optimistic'

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

### useOptimisticMutation

Use the `useOptimisticMutation` hook to create transactions in your components:

```tsx
import { useOptimisticMutation } from '@tanstack/react-optimistic'

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

### Write operations

#### Insert

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

#### Update

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

#### Delete

```typescript
// Delete a single item
delete todo

// Delete multiple items
delete [todo1, todo2]

// Delete with metadata
delete (todo, { metadata: { reason: "completed" } })
```
