# TanStack DB

<!-- ![TanStack DB Header](https://github.com/tanstack/db/raw/main/media/repo-header.png) -->

**A reactive client store for building super fast apps on sync**

TanStack DB extends TanStack Query with collections, live queries and optimistic mutations that keep your UI reactive, consistent and blazing fast 🔥

<p>
  <a href="https://x.com/intent/post?text=TanStack%20DB&url=https://tanstack.com/db">
    <img alt="#TanStack" src="https://img.shields.io/twitter/url?color=%2308a0e9&label=%23TanStack&style=social&url=https%3A%2F%2Ftwitter.com%2Fintent%2Ftweet%3Fbutton_hashtag%3DTanStack" /></a>
  <a href="#status">
    <img src="https://img.shields.io/badge/status-beta-yellow" alt="Status - BETA"></a>
  <a href="https://npmjs.com/package/@tanstack/db">
    <img alt="" src="https://img.shields.io/npm/dm/@tanstack/db.svg" /></a>
  <a href="https://discord.gg/yjUNbvbraC">
    <img alt="" src="https://img.shields.io/badge/Discord-TanStack-%235865F2" /></a>
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

- plug in any backend: sync engines, REST APIs, GraphQL, polling, custom sources
- builds on [TanStack Store](https://tanstack.com/store), works with and alongside [TanStack Query](https://tanstack.com/query)

## 💥 Usage example

Sync data into collections:

```ts
import { createCollection, QueryClient } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"

const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: async () => fetch("/api/todos"),
    queryClient: new QueryClient(),
    getKey: (item) => item.id,
    schema: todoSchema, // any standard schema
  })
)
```

Use live queries in your components:

```tsx
import { useLiveQuery } from "@tanstack/react-db"
import { eq } from "@tanstack/db"

const Todos = () => {
  const { data: todos } = useLiveQuery((query) =>
    query
      .from({ todos: todoCollection })
      .where(({ todos }) => eq(todos.completed, false))
  )

  return <List items={todos} />
}
```

Apply mutations with local optimistic state:

```tsx
// Define collection with persistence handlers
const todoCollection = createCollection({
  id: "todos",
  // ... other config
  onInsert: async ({ transaction }) => {
    const modified = transaction.mutations[0].modified
    await api.todos.create(modified)
  },
})

// Then use collection operators in your components
const AddTodo = () => {
  return (
    <Button
      onClick={() =>
        todoCollection.insert({
          id: uuid(),
          text: "🔥 Make app faster",
          completed: false,
        })
      }
    />
  )
}
```

## 📚 Docs

See the [Usage guide](./docs/overview.md) for more details, including how to do:

- real-time sync
- cross-collection queries
- fine-grained reactivity
- different strategies for data loading and handling mutations

There's also an example [React todo app](./examples/react/todo) and usage examples in the [package tests](./packages/db/tests).

## 🧱 Core concepts

### Collections

- typed sets of objects that can mirror a backend table or be populated with a filtered view or result set, such as `pendingTodos` or `decemberNewTodos`
- collections are just JavaScript data &mdash; load them on demand and define as many as you need

### Live queries

- run reactively against and across collections with support for joins, filters and aggregates
- powered by differential dataflow: query results update incrementally, not by re-running the whole query

### Transactional mutators

- batch and stage local changes across collections with immediate application of local optimistic updates
- sync transactions to the backend with automatic rollbacks and management of optimistic state

## 📦 Collection Types

TanStack DB provides several collection types to support different backend integrations:

- **`@tanstack/db`** - Core collection functionality with local-only and local-storage collections for offline-first applications
- **`@tanstack/query-db-collection`** - Collections backed by [TanStack Query](https://tanstack.com/query) for REST APIs and GraphQL endpoints
- **`@tanstack/electric-db-collection`** - Real-time sync collections powered by [ElectricSQL](https://electric-sql.com) for live database synchronization
- **`@tanstack/trailbase-db-collection`** - Collections for [TrailBase](https://trailbase.io) backend integration

## Framework integrations

TanStack DB integrates with React & Vue with more on the way!

- **`@tanstack/react-db`** - React hooks and components for using TanStack DB collections in React applications
- **`@tanstack/vue-db`** - Vue composables for using TanStack DB collections in Vue applications

## 🔧 Install

```bash
npm install @tanstack/react-db
# Optional: for specific collection types
npm install @tanstack/electric-db-collection @tanstack/query-db-collection
```

Other framework integrations are in progress.

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

## Status

Tanstack DB is currently in BETA. See [the release post](https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query) for more details.

## Contributing

View the contributing guidelines [here](https://github.com/TanStack/query/blob/main/CONTRIBUTING.md).

### [Become a Sponsor!](https://github.com/sponsors/tannerlinsley/)

<!-- Use the force, Luke -->
