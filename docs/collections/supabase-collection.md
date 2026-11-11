---
title: Supabase Collection
---

Supabase collections provide seamless integration between TanStack DB and [Supabase](https://supabase.com), keeping your UI in sync with Postgres through PostgREST queries, mutations, and Realtime subscriptions.

> **Experimental.** The Realtime integration is still being stabilized and may consume more Realtime messages than expected.
>
> Test in orgs on the free plan or with a spend cap. Set `realtime: false` on individual collections to opt out. To narrow a subscription to only send the needed messages and cut Realtime traffic, try the experimental `realtimeUseFilter: true` option (see [Real-time Subscriptions](#real-time-subscriptions)).

## Overview

[Supabase](https://supabase.com) is an open source Postgres development platform with auto-generated REST APIs (PostgREST), Realtime, Auth, and Row Level Security (RLS).

The `@tanstack/supabase-db-collection` package allows you to create collections that:

- Load data from your Supabase tables, pushing `where`, `orderBy`, and `limit` down to PostgREST
- Apply inserts, updates, and deletes optimistically, then roll back automatically if the server rejects them
- Receive changes made by other clients through Supabase Realtime, with no subscription code
- Derive their types from a [Standard Schema](https://standardschema.dev) (e.g., Zod, Valibot), so queries and mutations are type-checked end to end

Collections work with your Supabase project as it is and respect Row Level Security. Your Supabase database remains the source of truth: Postgres, RLS, Auth, and the rest of your stack stay unchanged, and no migration is required.

Collections fetch on the client. TanStack DB does not yet support server-side rendering (SSR), so collections should not be used to render on the server.

To see a working app, open the [example Todo app](https://todomvc-supabase-tanstack-db.vercel.app/).

## Installation

```bash
npm install @tanstack/supabase-db-collection @tanstack/react-db @tanstack/query-core @supabase/supabase-js
```

`@supabase/supabase-js` and `@tanstack/query-core` are peer dependencies. You also need an existing Supabase project with the client library and environment variables configured. If you have not set that up yet, follow the [Supabase getting started guide](https://supabase.com/docs/guides/getting-started).

The examples on this page use React. TanStack DB also supports Vue, Angular, Solid, Svelte, and vanilla JavaScript; swap `@tanstack/react-db` for the package that matches your framework.

> **Tip:** The [Supabase UI Library](https://supabase.com/ui/docs/nextjs/tanstack-db) provides a TanStack DB block that generates zod schemas and collections for every table in your database, so you do not have to write them by hand.

## Basic Usage

### 1. Enable Realtime for synced tables

Realtime is optional, but required if you want changes from other clients to appear automatically.

Enable Realtime for your table in the Supabase Table Editor, or run this in the SQL Editor:

```sql
alter publication supabase_realtime add table "public"."todos";
```

### 2. Define a collection

In TanStack DB, a collection corresponds to a Postgres table. Create one collection for each table you want to access from your frontend:

```typescript
import { createCollection } from '@tanstack/react-db'
import { supabaseCollectionOptions } from '@tanstack/supabase-db-collection'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
})

export const todosCollection = createCollection(
  supabaseCollectionOptions({
    tableName: 'todos',
    schema: todoSchema,
    keys: ['id'], // should match your primary key(s)
    supabase,
    realtime: true,
  })
)
```

### 3. Use the collection in components

Query collections with `useLiveQuery`. Mutations are methods on the collection, so call `collection.insert`, `collection.update`, or `collection.delete` directly. No hooks or mutation objects are required.

```tsx
import { useLiveQuery, eq } from '@tanstack/react-db'
import { todosCollection } from './collections'

function Todos() {
  const { data: todos, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ todo: todosCollection })
        .where(({ todo }) => eq(todo.completed, false)),
    [] // re-run the query when these dependencies change
  )

  // These apply instantly in the UI and roll back if the server rejects them
  const insertTodo = (title: string) => {
    todosCollection.insert({ id: crypto.randomUUID(), title, completed: false })
  }

  const completeTodo = (id: string) => {
    todosCollection.update(id, (draft) => {
      draft.completed = true
    })
  }

  const deleteTodo = (id: string) => {
    todosCollection.delete(id)
  }

  if (isLoading) return <p>Loading...</p>

  return (
    <div>
      <button onClick={() => insertTodo('Buy milk')}>Add todo</button>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            {todo.title}
            <button onClick={() => completeTodo(todo.id)}>Complete</button>
            <button onClick={() => deleteTodo(todo.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

## Configuration Options

The `supabaseCollectionOptions` function accepts the following options:

### Required Options

- `tableName`: Name of the Postgres table. Maps to the PostgREST endpoint
- `schema`: [Standard Schema](https://standardschema.dev) compatible schema (e.g., Zod, Valibot) describing a single row
- `keys`: Column or columns that uniquely identify a row. Should match the primary key(s) on your table. Used to derive the collection key and to match rows on update and delete. With a single column, the collection key is that column's value; with several, the values are joined with `-`
- `supabase`: Supabase client instance used for queries, mutations, and the Realtime subscription

### Optional Options

| Option              | Type                      | Default       | Description                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `syncMode`          | `'on-demand'` \| `'eager'` | `'on-demand'` | Controls what is loaded into the collection. `'on-demand'` loads only the rows that live queries need, pushing `where`, `orderBy`, and `limit` to PostgREST. `'eager'` loads the whole table up front, paging past the PostgREST row cap, and evaluates queries against the local copy. See [How Sync Works](#how-sync-works). |
| `realtime`          | `boolean`                 | `false`       | When `true`, subscribes to Postgres changes and reconciles inserts, updates, and deletes from other clients into the collection.                                                                                                                                                                                                                                                       |
| `realtimeUseFilter` | `boolean`                 | `false`       | **Experimental.** Only applies when `realtime` is `true`. When `true`, each active query's `WHERE` clause is pushed to the Realtime subscription as a `postgres_changes` filter, so the channel only receives changes those queries care about. When `false`, the collection subscribes to every change on the table and filters client-side. Queries whose `WHERE` cannot be expressed as a Realtime filter (e.g. `or(...)`) transparently fall back to the unfiltered subscription. |
| `queryClient`       | `QueryClient`             | shared client | TanStack Query client. If omitted, a shared global client is used.                                                                                                                                                                                                                                                                                                                      |
| `parse`             | `{ [column]: (value) => … }` | none       | Converts a column value received from PostgREST or Realtime into the value your schema describes. PostgREST speaks JSON, so a `timestamptz` arrives as a string: use `parse` to turn it into a `Date`. Applies to rows read, rows returned by inserts and updates, and Realtime payloads. Not called for `null` values. |
| `serialize`         | `{ [column]: (value) => … }` | none       | The reverse of `parse`: converts a column value held by the collection into the JSON value sent to PostgREST in insert and update bodies, and used to match rows by key on update and delete. Not called for `null` values. |

PostgREST returns a `bigint` as a JSON number, which JavaScript rounds to the nearest double above `Number.MAX_SAFE_INTEGER` (9007199254740991). Values that large cannot round-trip through a `bigint` column; store them in a `text` column and convert them with `parse` and `serialize`.

```ts
supabaseCollectionOptions({
  tableName: 'events',
  keys: ['id'],
  schema: eventSchema, // startsAt: z.date()
  supabase,
  parse: { startsAt: (value) => new Date(value as string) },
  serialize: { startsAt: (value) => value.toISOString() },
})
```

The `onInsert`, `onUpdate`, and `onDelete` handlers are provided by the adapter and write through PostgREST; they are not configurable.

## How Sync Works

Supabase collections are built on top of [Query Collection](./query-collection.md). Each live query is translated into PostgREST requests, the results are cached with TanStack Query, and Realtime events are merged into the same collection.

### Sync modes

- **`'on-demand'` (default):** the collection does not load anything until a live query subscribes. Each query fetches only the rows it needs, with filters, ordering, and limits sent to PostgREST. Use this for large tables or when each screen only shows a small slice of the data.
- **`'eager'`:** the whole table is loaded when the collection starts syncing, paging past the PostgREST row cap (see [Row cap and pagination](#row-cap-and-pagination)). Queries then run against the local copy. Use this for small, read-mostly tables that many queries touch.

### Pushed to PostgREST

Most query operations are translated to PostgREST filters and run server-side. A handful of operations run client-side instead.

| Operation                                                                             | Notes                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FROM`                                                                                | Maps to the PostgREST table endpoint.                                                                                                                                                                                                                     |
| `WHERE` (`eq`, `gt`, `gte`, `lt`, `lte`, `inArray`, `like`, `ilike`, `not`, `isNull`) | Translated to PostgREST filter syntax.                                                                                                                                                                                                                    |
| `AND` (multiple conditions or chained `.where`)                                       | Translated to PostgREST filter syntax. A conjunct that cannot be pushed is dropped on its own; the request returns a superset and the client re-filters it.                                                                                               |
| `OR` and nested `AND`/`OR`                                                            | Translated to PostgREST's `or=(…)` syntax. All-or-nothing: if any branch cannot be pushed the whole `or` is dropped, because dropping one branch would narrow the result and lose matching rows.                                                          |
| `ORDER BY` (on source columns)                                                        | Translated to PostgREST ordering.                                                                                                                                                                                                                         |
| `LIMIT`                                                                               | Translated to PostgREST limiting.                                                                                                                                                                                                                         |
| `JOIN`                                                                                | Each table is fetched separately. The join key is pushed as an `in` filter on the second query.                                                                                                                                                          |

`like` and `ilike` use TanStack's SQL wildcards: `%` matches any sequence and `_` matches one character (for example, `ilike(user.name, '%alice%')`). Patterns containing a literal `*` are evaluated client-side because PostgREST interprets `*` as a wildcard. Filter values containing commas, parentheses, quotes, or backslashes are escaped automatically.

### Evaluated client-side

These operations fetch the required rows and process them in memory:

- `SELECT` column subsets, renaming, and computed fields (`upper`, `lower`, `concat`, `length`, `add`, `coalesce`)
- Aggregate functions: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX` (except when using [`queryOnce`](#queryonce))
- `GROUP BY` and `HAVING`
- `DISTINCT`
- `ORDER BY` on computed fields

### Row cap and pagination

PostgREST caps every response at its `db-max-rows` setting (1000 by default on Supabase). Collection reads and non-aggregate `queryOnce` queries page past this cap automatically: the adapter loops with `offset`, using a one-time `count=exact` on the first request to fetch the complete matching set (or the caller's `limit`).

The aggregate / `GROUP BY` / `HAVING` path of `queryOnce` is the one exception. It issues a single request and is **not** paginated. Aggregate results are a few rows, so the cap is moot, but a `GROUP BY` / `HAVING` query whose grouped output exceeds `db-max-rows` is silently truncated at the cap. Add an explicit `limit`, or narrow the query, if you expect more grouped rows than the cap.

Known limitations of the paging loop:

- **Ordering.** Pages are stitched together with `offset`, and PostgreSQL does not guarantee a consistent row order across separate `LIMIT`/`OFFSET` queries unless the sort is total. When a read needs more than one page, the adapter therefore reads every page, including the first, ordered by the collection's `keys` after any `orderBy` of the query, so the pages come from one sequence. A read that fits in a single page is sent as written.
- **Concurrent writes.** Offset paging is not keyset-stable: a row inserted or deleted by another client while a multi-page read is in flight shifts the remaining rows by one offset, so a row can be missed or duplicated until the next refetch.
- **Count cost.** Every collection read issues one `Prefer: count=exact` on its first request so the loop knows when to stop. On very large tables, or under heavy RLS, that is a full `count(*)` per read.

## Real-time Subscriptions

With `realtime: true`, the collection subscribes to Postgres changes for its table and reconciles inserts, updates, and deletes made by other clients. The table must be added to the `supabase_realtime` publication (see [Basic Usage](#1-enable-realtime-for-synced-tables)).

```typescript
const todosCollection = createCollection(
  supabaseCollectionOptions({
    tableName: 'todos',
    schema: todoSchema,
    keys: ['id'],
    supabase,
    realtime: true,
    // Experimental: only receive changes that match active queries
    realtimeUseFilter: true,
  })
)
```

Row Level Security applies to Realtime, so clients only receive changes they are allowed to read. A server-side Supabase client has no Realtime channel, so `realtime` is a no-op there.

Known limitation: the initial fetch does not wait for the Realtime channel to finish subscribing. A row written in the window between the fetch and the subscription going live can be missed by both.

## Mutations and Optimistic Updates

`insert`, `update`, and `delete` on the collection apply to the UI immediately, then are sent to Supabase through PostgREST. The adapter owns the persistence handlers:

- **Insert** sends a `POST` and writes the row returned by the server back into the collection, so database defaults (generated ids, timestamps) appear without a refetch.
- **Update** sends a `PATCH` matched on the `keys` columns and writes back the returned row.
- **Delete** sends a `DELETE` matched on the `keys` columns.

If the server rejects a mutation (for example, because an RLS policy denies it), the optimistic change is rolled back automatically.

```typescript
// Applies instantly; rolls back if Postgres or RLS rejects it
todosCollection.update(todoId, (draft) => {
  draft.completed = true
})
```

See [Optimistic Mutations](../guides/mutations.md) for more on mutation lifecycles, transactions, and error handling.

## queryOnce

`queryOnce(callback, supabase)` runs a TanStack DB query once against Supabase and resolves with the result. It is non-reactive: it issues the needed requests and does not subscribe to changes. Use it for one-shot fetches such as API routes or form submissions where live updates are not needed.

```typescript
import { eq } from '@tanstack/react-db'
import { queryOnce } from '@tanstack/supabase-db-collection'

const completedTodos = await queryOnce(
  (q) =>
    q
      .from({ todo: todosCollection })
      .where(({ todo }) => eq(todo.completed, true)),
  supabase
)
```

- `callback`: Builds the query using the same API as `useLiveQuery`
- `supabase`: Supabase client used to execute the request

It returns a `Promise` that resolves to the query result, typed from the query you built.

Filters, ordering, `limit`, `offset`, joins, and aggregate functions (`count`, `sum`, `avg`, `min`, `max`) are pushed to PostgREST. Operations that cannot be pushed fall back to fetching matching rows and processing them client-side. Fallback operations include `GROUP BY`, `HAVING`, `DISTINCT`, and computed `SELECT` expressions.

The client-side filter fallback applies to live queries and ordinary `queryOnce` queries. The server aggregate path in `queryOnce` requires fully pushable `WHERE` expressions and throws for unsupported filters, rather than returning an aggregate over unfiltered rows.

## Complete Example

```tsx
import { createCollection, useLiveQuery, eq } from '@tanstack/react-db'
import { supabaseCollectionOptions } from '@tanstack/supabase-db-collection'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
)

// Define the schema for a single row
const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
})

type Todo = z.infer<typeof todoSchema>

// Create the collection
export const todosCollection = createCollection(
  supabaseCollectionOptions({
    tableName: 'todos',
    schema: todoSchema,
    keys: ['id'],
    supabase,
    syncMode: 'on-demand',
    realtime: true,
  })
)

// Use in a component
function TodoList() {
  const { data: todos, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ todo: todosCollection })
        .where(({ todo }) => eq(todo.completed, false))
        .orderBy(({ todo }) => todo.title, 'asc'),
    []
  )

  const addTodo = (title: string) => {
    const todo: Todo = { id: crypto.randomUUID(), title, completed: false }
    todosCollection.insert(todo)
  }

  const toggleTodo = (todo: Todo) => {
    todosCollection.update(todo.id, (draft) => {
      draft.completed = !draft.completed
    })
  }

  const removeTodo = (id: string) => {
    todosCollection.delete(id)
  }

  if (isLoading) return <p>Loading...</p>

  return (
    <div>
      <button onClick={() => addTodo('Buy milk')}>Add todo</button>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => toggleTodo(todo)}
            />
            {todo.title}
            <button onClick={() => removeTodo(todo.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

## FAQ

**Will this work with my RLS policies?**

Yes. Supabase collections go through PostgREST and Realtime, so your existing RLS policies apply automatically.

**What if I do not use RLS?**

Without RLS, all Realtime changes broadcast to every client. Depending on whether your app is public or private, that may not be what you want.

**Can I use a Supabase collection and `supabase-js` in parallel?**

Yes. The collection uses `supabase-js` under the hood, so they are compatible. Data fetched directly through `supabase-js` will not appear in the collection.

Use `supabase-js` as a fallback for features TanStack DB does not cover, such as database functions through `.rpc` or complex `GROUP BY` queries.

**Will this work with a custom API server?**

This package targets Supabase and PostgREST tables. For custom backends, use [Query Collection](./query-collection.md) or write your own collection with the [Collection Options Creator guide](../guides/collection-options-creator.md).

## Learn More

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime)
- [Supabase UI Library: TanStack DB block](https://supabase.com/ui/docs/nextjs/tanstack-db)
- [Example Todo app](https://todomvc-supabase-tanstack-db.vercel.app/)
- [Query Collection](./query-collection.md)
- [Optimistic Mutations](../guides/mutations.md)
- [Live Queries](../guides/live-queries.md)
