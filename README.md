# TanStack DB

<!-- ![TanStack DB Header](https://github.com/tanstack/db/raw/main/media/repo-header.png) -->

**A reactive client store for building super fast apps on sync**

TanStack DB extends TanStack Query with collections, live queries and transactional mutations that keep your UI reactive, consistent and blazing fast 🔥

<p>
  <a href="https://x.com/intent/post?text=TanStack%20DB&url=https://tanstack.com/db">
    <img alt="#TanStack" src="https://img.shields.io/twitter/url?color=%2308a0e9&label=%23TanStack&style=social&url=https%3A%2F%2Ftwitter.com%2Fintent%2Ftweet%3Fbutton_hashtag%3DTanStack" /></a>
  <a href="https://discord.gg/yjUNbvbraC">
    <img alt="" src="https://img.shields.io/badge/Discord-TanStack-%235865F2" /></a>
  <a href="https://discord.electric-sql.com">
    <img alt="" src="https://img.shields.io/badge/Discord-Electric-%235865F2" /></a>
  <a href="https://npmjs.com/package/@tanstack/db">
    <img alt="" src="https://img.shields.io/npm/dm/@tanstack/db.svg" /></a>
  <a href="https://github.com/tanstack/db/discussions">
    <img alt="Join the discussion on Github" src="https://img.shields.io/badge/Discussions-Chat%20now!-green" /></a>
  <a href="https://x.com/tan_stack">
    <img alt="" src="https://img.shields.io/twitter/follow/tan_stack.svg?style=social&label=Follow @TanStack" /></a>
</p>

Enjoy this library? Try the entire [TanStack](https://tanstack.com), including [TanStack Query](https://tanstack.com/query), [TanStack Store](https://tanstack.com/store), etc.

## 🚀 Why TanStack DB?

TanStack DB gives you robust support for real-time sync, live queries and local writes. With no stale data, super fast re-rendering and sub-millisecond cross-collection queries — even for large complex apps.

Built on a TypeScript implementation of differential dataflow ([#](https://github.com/electric-sql/d2ts)), TanStack DB gives you:

- 🔥 **a blazing fast query engine**<br />
  for sub-millisecond live queries &mdash; even for complex queries with joins and aggregates
- 🎯 **fine-grained reactivity**<br />
  to minimize component re-rendering
- 💪 **robust transaction primitives**<br />
  for easy optimistic mutations with sync and lifecycle support
- 🌟 **normalized data**<br />
  to keep your backend simple

TanStack DB is **backend agnostic** and **incrementally adoptable**:

- plug in any backend: sync engines, polling APIs, GraphQL, custom sources
- builds on [TanStack Store](https://tanstack.com/store), works with and alongside [TanStack Query](https://tanstack.com/query)

## 💥 Usage example

Sync data into collections:

```ts
import { createElectricCollection } from "@tanstack/db-collections"

// You can configure any strategy you like to load data into
// collections. Here we're using the Electric sync engine.
export const todoCollection = createElectricCollection<Todo>({
  id: "todos",
  streamOptions: {
    url: "https://example.com/v1/shape",
    params: {
      table: "todos",
    },
  },
  primaryKey: ["id"],
  schema: todoSchema, // standard schema interface
})
```

Bind live queries to your components:

```tsx
import { useLiveQuery } from "@tanstack/react-optimistic"

const Todos = () => {
  const { data: todos } = useLiveQuery((query) =>
    // You can query across collections with where clauses,
    // joins, aggregates, etc. Here we're doing a simple query
    // for all the todos that aren't completed.
    query
      .from({ todoCollection })
      .where("@completed", "=", false)
      .select("@id", "@text")
      .keyBy("@id")
  )

  return <List items={todos} />
}
```

Define a `mutationFn` to handle persistence of local writes:

```tsx
import type { Collection } from "@tanstack/optimistic"
import type { MutationFn, PendingMutation } from "@tanstack/react-optimistic"

const filterOutCollection = (mutation: PendingMutation) => {
  const { collection: _, ...rest } = mutation

  return rest
}

// You can handle mutations any way you like. Here, we define a
// generic function that POSTs them to the server.
const mutationFn: MutationFn = async ({ transaction }) => {
  const payload = transaction.mutations.map(filterOutCollection)
  const response = await fetch("https://api.example.com", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
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

Use it in your components:

```tsx
import { useOptimisticMutation } from "@tanstack/react-optimistic"

const AddTodo = () => {
  const tx = useOptimisticMutation({ mutationFn })

  const addTodo = () => {
    // Triggers the mutationFn to sync data in the background.
    tx.mutate(() =>
      // Instantly applies the local optimistic state.
      todoCollection.insert({
        id: uuid(),
        text: "🔥 Make app faster",
        completed: false,
      })
    )
  }

  return <Button onClick={addTodo} />
}
```

For transactional writes with local optimistic state and managed background sync.

## 🧱 Core concepts

### Collections

- typed sets of objects that can mirror a backend table or be populated with a filtered view or result set, such as `pendingTodos` or `decemberNewTodos`
- collections are just JavaScript data &mdash; load them on demand and define as many as you need

### Live Queries

- run reactively against and across collections with support for joins, filters and aggregates
- powered by differential dataflow: query results update incrementally, not by re-running the whole query

### Transactions

- batch and stage local changes across collections with immediate application of local optimistic updates
- sync to the backend using flexible mutationFns with automatic rollbacks and management of optimistic state

## 🔧 Install

```bash
npm install @tanstack/db
```

## 📚 Docs

See the [Documentation](./docs/index.md) for usage guides and the API reference.

There's also an example [React todo app](./examples/react/todo).

## ❓ FAQ

**How is this different from TanStack Query?**<br />
TanStack DB builds _on top of_ TanStack Query. Use Query to fetch data; use DB to manage reactive local collections and mutations. They complement each other.

**Do I need a sync engine like ElectricSQL?**<br />
No. TanStack DB _is_ designed to work with sync engines like [Electric](https://electric-sql.com) but _also_ works with any backend: polling APIs, GraphQL, REST, or custom sync logic.

**What is a Collection? Is it like a DB table?**<br />
Kind of. Collections are typed sets of objects, but they can also be filtered views or custom groupings. They're just JavaScript structures that you define and manage.

**Is this an ORM? Do queries hit my backend?**<br />
No. TanStack DB is not an ORM. Queries run entirely in the client against local collections. The framework provides strong primitives to manage how data is loaded and synced.

## Partners

<a href="https://electric-sql.com">
  <img alt="ElectricSQL logo"
      src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo.with-background.sm.png"
  />
</a>

## Contributing

View the contributing guidelines [here](https://github.com/TanStack/query/blob/main/CONTRIBUTING.md).

### [Become a Sponsor!](https://github.com/sponsors/tannerlinsley/)

<!-- Use the force, Luke -->
