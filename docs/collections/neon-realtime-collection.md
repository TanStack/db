---
title: Neon Realtime Collection
---

Neon Realtime collections integrate TanStack DB with [Neon Realtime](https://neon.com/docs/realtime/overview), syncing the results of live SQL queries from Postgres into client-side collections.

## Overview

The `@neon/realtime-tanstack` package, maintained by Neon, allows you to create collections that:

- Sync live SQL query results, including joins, aggregates, ordering, and limits
- Apply complete query results and committed change batches atomically
- Support local live queries with filters, sorts, and joins across collections
- Handle optimistic updates with transaction ID matching and automatic rollback on errors

Neon Realtime is currently in beta. Follow the [Neon Realtime quickstart](https://neon.com/docs/realtime/quickstart) to enable it on your branch and configure your application's allowed origins before creating a collection.

## Installation

Install the Realtime SDK, its TanStack DB adapter, and your framework integration. The examples below use React:

```bash
npm install @neon/realtime @neon/realtime-tanstack @tanstack/react-db
```

## Basic Usage

A Realtime collection needs a client, a sealed query from your backend, and a stable key for each row. A sealed query lets the browser subscribe to an authorized SQL query without being able to change its SQL or parameters.

The examples share this row type in `types.ts`:

```ts
export type Todo = {
  id: string
  title: string
  completed: boolean
}
```

### Seal a Query on the Server

Define and seal queries in trusted backend code. For example, this handler serves `POST /api/todos/live`. It assumes a `todos` table with `id`, `title`, `completed`, and `user_id` columns, and an application `requireUser` function that authenticates the request:

```ts
import { createRealtime, rawSql } from '@neon/realtime/server'
import { requireUser } from './auth'

const realtime = createRealtime({
  secret: process.env.NEON_REALTIME_SECRET!,
  db: 'neondb',
})

export async function POST(request: Request) {
  const user = await requireUser(request)
  const query = rawSql(
    'SELECT id, title, completed FROM todos WHERE user_id = $1',
    [user.id],
  )

  return Response.json(await realtime.seal({ query }))
}
```

Use the database name from your connection string for `db`. Keep `NEON_REALTIME_SECRET` on the server. Authorize the request before sealing, and derive user-specific parameters from the authenticated session. See Neon's [query and authorization guide](https://neon.com/docs/realtime/guides/queries) for ORM adapters and other ways to expose sealed queries.

### Create the Collection

In browser code, create one Realtime client for your application and fetch the sealed query from your endpoint. For example, in `collections.ts`:

```ts
import { createCollection } from '@tanstack/react-db'
import { createRealtimeClient } from '@neon/realtime/client'
import { realtimeCollectionOptions } from '@neon/realtime-tanstack'
import type { SealedLiveQuery } from '@neon/realtime/client'
import type { Todo } from './types'

const client = createRealtimeClient({
  url: 'YOUR_NEON_REALTIME_URL',
})

async function fetchTodosQuery(): Promise<SealedLiveQuery<Todo>> {
  const response = await fetch('/api/todos/live', { method: 'POST' })

  if (!response.ok) {
    throw new Error(`Could not fetch the todos query (${response.status})`)
  }

  return response.json()
}

export const todosCollection = createCollection(
  realtimeCollectionOptions({
    id: 'todos',
    client,
    query: await fetchTodosQuery(),
    refreshQuery: fetchTodosQuery,
    getKey: (todo: Todo) => todo.id,
  }),
)
```

Replace `YOUR_NEON_REALTIME_URL` with the Realtime URL for your branch. The client opens a WebSocket lazily and shares it across subscriptions. The adapter takes the client directly, so it does not need Neon's React `RealtimeProvider`.

Create the collection once for the signed-in user and reuse it across components. This example is browser-only. For server rendering, use request-scoped collections and follow the [SSR and hydration guide](../guides/ssr.md) and [Neon's TanStack Start example](https://neon.com/docs/realtime/examples/tanstack).

## Configuration Options

The `realtimeCollectionOptions` function accepts the following options:

### Required Options

| Option   | Description                                                                 |
| -------- | --------------------------------------------------------------------------- |
| `client` | A reusable `RealtimeClient` created with `createRealtimeClient()`           |
| `query`  | The initial `SealedLiveQuery<Row>` for the SQL query backing the collection |
| `getKey` | A function that returns a stable, unique string or number key for each row  |

Use a primary key or another stable, unique value from the query result for `getKey`. A Realtime subscription's opaque `rowId` is not a stable application key.

### Optional Options

| Option                             | Description                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `id`                               | A unique identifier for the collection                                                      |
| `refreshQuery`                     | An async function that obtains a fresh sealed query for the same SQL and parameters         |
| `schema`                           | A [Standard Schema](https://standardschema.dev) compatible schema for collection validation |
| `onInsert`, `onUpdate`, `onDelete` | Mutation handlers that persist optimistic writes to your backend                            |
| `startSync`                        | Start syncing on collection creation instead of waiting for the first subscriber            |
| `gcTime`                           | Time in milliseconds before an unused collection is garbage collected                       |

The adapter uses eager synchronization: it syncs the full result of the sealed SQL query. TanStack DB filters, ordering, joins, and limits run locally over those rows. They do not change the server query or fetch rows outside its result.

See the [Neon SDK reference](https://neon.com/docs/realtime/sdks/typescript#tanstack-db-realtimecollectionconfig) for all supported options.

### Renewing Sealed Queries

Sealed queries are short-lived. Provide `refreshQuery` to renew the subscription before the current query expires. It must return a sealed query for the same SQL and parameter values. To change those parameters, create a collection with a newly sealed query.

The adapter retries failed refresh requests. Once a collection is ready, it retains its last rows and stays ready while the subscription reconnects or waits for renewal. Readiness alone does not mean those rows are current. A terminal subscription error ends automatic recovery; handle sync failures in the UI as shown below.

Use your application's auth state to stop consumers and clean up user-specific collections on sign-out. A failed renewal request alone does not clear the collection's rows. Sealed queries are bearer tokens: send them over HTTPS and keep them out of URLs, logs, and persistent browser storage.

## Querying the Collection

Pass the collection to your components and use TanStack DB's `useLiveQuery` to derive local views from the synced rows:

```tsx
import { eq, useLiveQuery } from '@tanstack/react-db'
import type { Collection } from '@tanstack/react-db'
import type { Todo } from './types'

export function TodoList({
  todosCollection,
}: {
  todosCollection: Collection<Todo, string>
}) {
  const {
    data: todos,
    isReady,
    isLoadingError,
    isCrashed,
    isSyncError,
  } = useLiveQuery({
    query: (q) =>
      q
        .from({ todo: todosCollection })
        .where(({ todo }) => eq(todo.completed, false))
        .orderBy(({ todo }) => todo.title, 'asc'),
  })

  if (isLoadingError || isCrashed) return <p>Could not load todos</p>
  if (!isReady) return <p>Loading todos...</p>

  return (
    <>
      {isSyncError && (
        <p>Live updates stopped. Showing the last synced todos.</p>
      )}
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
    </>
  )
}
```

Sync begins when the first live query subscribes, unless `startSync` is enabled. The collection becomes ready after the first complete query result arrives. Other views can query the same rows without another sealed query or server round trip.

## Persistence Handlers & Synchronization

Realtime syncs reads. Persist writes through your own backend using `onInsert`, `onUpdate`, and `onDelete`. TanStack DB applies changes optimistically and invokes the matching handler once per transaction, with all of its mutations.

After the backend commits a write, wait for its Postgres transaction ID with `collection.utils.awaitTxId(txid, timeout)`. This keeps the optimistic state until the corresponding synced changes have entered TanStack DB's sync queue.

For example, add these handlers to the collection options above. The application API functions shown here send each batch in one request and return `{ txid: string | null }`, with `null` when no rows changed:

```ts
import { createCollection } from '@tanstack/react-db'
import { realtimeCollectionOptions } from '@neon/realtime-tanstack'
import { api } from './api'
import type { Todo } from './types'

export const todosCollection = createCollection(
  realtimeCollectionOptions({
    id: 'todos',
    client,
    query: await fetchTodosQuery(),
    refreshQuery: fetchTodosQuery,
    getKey: (todo: Todo) => todo.id,
    onInsert: async ({ transaction, collection }) => {
      const { txid } = await api.todos.create(
        transaction.mutations.map(({ modified }) => modified),
      )

      if (txid) await collection.utils.awaitTxId(txid, 10_000)
    },
    onUpdate: async ({ transaction, collection }) => {
      const { txid } = await api.todos.update(
        transaction.mutations.map(({ key, changes }) => ({ id: key, changes })),
      )

      if (txid) await collection.utils.awaitTxId(txid, 10_000)
    },
    onDelete: async ({ transaction, collection }) => {
      const { txid } = await api.todos.delete(
        transaction.mutations.map(({ key }) => key),
      )

      if (txid) await collection.utils.awaitTxId(txid, 10_000)
    },
  }),
)
```

Each backend handler must authenticate the request, validate the batch, and scope writes to the authenticated user. Return the ID from the same Postgres transaction that performed the write, after it commits. Use `pg_current_xact_id()::text` to return the decimal string expected by `awaitTxId`; for example, include it in a write statement's `RETURNING` clause. Write each batch atomically so there is one transaction ID to wait for. See Neon's [backend mutation examples](https://neon.com/docs/realtime/guides/mutations#returning-the-txid-from-your-backend).

Pass an explicit timeout to `awaitTxId`. Without one, it can wait until the transaction arrives or the collection is cleaned up. Keep waits bounded because TanStack DB holds synced changes while a mutation handler runs. A rejected write or failed wait rolls back the optimistic change. If the write committed but its sync confirmation timed out, it remains saved on the server and appears when sync catches up.

With the handlers configured, use the normal collection mutation methods:

```ts
import { todosCollection } from './collections'

const id = crypto.randomUUID()
const inserted = todosCollection.insert({
  id,
  title: 'Try Neon Realtime',
  completed: false,
})

await inserted.when('settled')

const updated = todosCollection.update(id, (draft) => {
  draft.completed = true
})
await updated.when('settled')

const deleted = todosCollection.delete(id)
await deleted.when('settled')
```

An optimistic insert needs a complete row with its final key. Wait for a write to settle before sending another write that depends on it, or disable controls while a row's `$hasPendingWrites` is true. Handle rejections from `transaction.when('settled')` to show write errors in your UI.

## Additional Resources

- [Neon Realtime documentation](https://neon.com/docs/realtime/overview)
- [TanStack DB integration guide](https://neon.com/docs/realtime/guides/reactivity#tanstack-db)
- [TanStack DB SDK reference](https://neon.com/docs/realtime/sdks/typescript#tanstack-db)
- [Optimistic mutations with TanStack DB](https://neon.com/docs/realtime/guides/mutations#with-tanstack-db-collections)
- [TanStack Start example](https://neon.com/docs/realtime/examples/tanstack)
- [Live Queries guide](../guides/live-queries.md)
- [Mutations guide](../guides/mutations.md)
- [Error Handling guide](../guides/error-handling.md)
