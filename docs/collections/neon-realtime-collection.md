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

> **Version compatibility:** The published `@neon/realtime-tanstack@0.1.1` adapter supports TanStack DB **0.9 only**. It has not been updated for **1.0 RC**. The TanStack DB examples below use 1.0 RC APIs and require a compatible adapter release. For a working 0.9 integration today, follow [Neon's TanStack example](https://neon.com/docs/realtime/examples/tanstack).

## Installation

In an existing TanStack DB 0.9 application, install the Realtime SDK and its adapter:

```bash
npm install @neon/realtime@0.1.1 @neon/realtime-tanstack@0.1.1
```

Keep your framework integration on a version that depends on `@tanstack/db` 0.9. The examples below use React's `@tanstack/react-db` integration. Do not install the current Neon adapter into a 1.0 RC application.

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
  const input: unknown = await request.json()

  if (
    typeof input !== 'object' ||
    input === null ||
    !('userId' in input) ||
    input.userId !== user.id
  ) {
    return new Response('Session changed', { status: 401 })
  }

  const query = rawSql(
    'SELECT id, title, completed FROM todos WHERE user_id = $1',
    [user.id],
  )

  return Response.json(await realtime.seal({ query }))
}
```

Use the database name from your connection string for `db`. Keep `NEON_REALTIME_SECRET` on the server. Authorize the request before sealing, and derive user-specific parameters from the authenticated session. The browser's `userId` only checks that the session still belongs to the user who opened the collection; it does not grant access. See Neon's [query and authorization guide](https://neon.com/docs/realtime/guides/queries) for ORM adapters and other ways to expose sealed queries.

### Create the Collection

In browser code, create one Realtime client for your application. Export a factory that fetches the sealed query after sign-in, rather than fetching during module import. For example, in `collections.ts`:

```ts
import { createCollection } from '@tanstack/react-db'
import { createRealtimeClient } from '@neon/realtime/client'
import { realtimeCollectionOptions } from '@neon/realtime-tanstack'
import type { SealedLiveQuery } from '@neon/realtime/client'
import type { Todo } from './types'

const client = createRealtimeClient({
  url: 'YOUR_NEON_REALTIME_URL',
})

async function fetchTodosQuery(
  userId: string,
  signal: AbortSignal,
): Promise<SealedLiveQuery<Todo>> {
  const response = await fetch('/api/todos/live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Could not fetch the todos query (${response.status})`)
  }

  return response.json()
}

export async function createTodosCollection(userId: string, signal: AbortSignal) {
  const refreshQuery = () => fetchTodosQuery(userId, signal)
  const query = await refreshQuery()
  signal.throwIfAborted()

  return createCollection(
    realtimeCollectionOptions({
      id: `todos:${userId}`,
      client,
      query,
      refreshQuery,
      getKey: (todo: Todo) => todo.id,
      gcTime: 0,
    }),
  )
}

export type TodosCollection = Awaited<ReturnType<typeof createTodosCollection>>
```

Replace `YOUR_NEON_REALTIME_URL` with the Realtime URL for your branch. The client opens a WebSocket lazily and shares it across subscriptions. The adapter takes the client directly, so it does not need Neon's React `RealtimeProvider`.

After sign-in, create an `AbortController` for that signed-in session and call `await createTodosCollection(user.id, controller.signal)` in your authenticated route loader or application setup. Handle setup errors there, then pass the result to components. Reuse that collection for the session. `gcTime: 0` disables automatic garbage collection so the session owner controls cleanup.

On sign-out or a user switch, remove the collection's consumers, abort the controller, and await `todosCollection.cleanup()` before discarding it. Aborting also cancels a pending setup request; the factory checks the signal before returning a collection. Create a new controller and collection for the next session. Never reuse the previous user's collection or signal.

This example is browser-only. For server rendering, use request-scoped collections and follow the [SSR and hydration guide](../guides/ssr.md) and [Neon's TanStack Start example](https://neon.com/docs/realtime/examples/tanstack).

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

Use your application's auth state to end the session lifecycle described above on sign-out, a user switch, or a 401 renewal response. A failed renewal request alone does not clear the collection's rows. The server's user check prevents a renewal from silently switching the collection to another user's query. Sealed queries are bearer tokens: send them over HTTPS and keep them out of URLs, logs, and persistent browser storage.

## Querying the Collection

Pass the collection to your components and use TanStack DB's `useLiveQuery` to derive local views from the synced rows:

```tsx
import { eq, useLiveQuery } from '@tanstack/react-db'
import type { Collection } from '@tanstack/react-db'
import type { RealtimeCollectionUtils } from '@neon/realtime-tanstack'
import type { Todo } from './types'

export function TodoList({
  todosCollection,
}: {
  todosCollection: Collection<Todo, string, RealtimeCollectionUtils>
}) {
  const {
    data: todos,
    isReady,
    isLoading,
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
  if (isLoading) return <p>Loading todos...</p>
  if (!isReady) return null

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

In `collections.ts`, keep the existing imports, `client`, `fetchTodosQuery`, and `TodosCollection` type. Add the `api` import and error class below, and **replace** the existing `createTodosCollection` function with this writable version. The application API functions send `{ userId, batch }` in one request, pass `signal` to `fetch`, and return `{ txid: string | null }`, with `null` when no rows changed:

```ts
import { api } from './api'

export class NotSyncedYetError extends Error {}

function notSyncedYet(cause: unknown): never {
  throw new NotSyncedYetError('Saved, but not synced yet', { cause })
}

export async function createTodosCollection(userId: string, signal: AbortSignal) {
  const refreshQuery = () => fetchTodosQuery(userId, signal)
  const query = await refreshQuery()
  signal.throwIfAborted()

  return createCollection(
    realtimeCollectionOptions({
      id: `todos:${userId}`,
      client,
      query,
      refreshQuery,
      getKey: (todo: Todo) => todo.id,
      gcTime: 0,
      onInsert: async ({ transaction, collection }) => {
        const { txid } = await api.todos.create({
          userId,
          batch: transaction.mutations.map(({ modified }) => modified),
          signal,
        })

        if (txid) {
          await collection.utils.awaitTxId(txid, 10_000).catch(notSyncedYet)
        }
      },
      onUpdate: async ({ transaction, collection }) => {
        const { txid } = await api.todos.update({
          userId,
          batch: transaction.mutations.map(({ key, changes }) => ({ id: key, changes })),
          signal,
        })

        if (txid) {
          await collection.utils.awaitTxId(txid, 10_000).catch(notSyncedYet)
        }
      },
      onDelete: async ({ transaction, collection }) => {
        const { txid } = await api.todos.delete({
          userId,
          batch: transaction.mutations.map(({ key }) => key),
          signal,
        })

        if (txid) {
          await collection.utils.awaitTxId(txid, 10_000).catch(notSyncedYet)
        }
      },
    }),
  )
}
```

Each backend handler must authenticate the request, reject a `userId` that differs from the session (as the sealing endpoint does), validate the batch, and scope writes to the authenticated user. Return the ID from the same Postgres transaction that performed the write, after it commits. Use `pg_current_xact_id()::text` to return the full 64-bit decimal string expected by Neon; for example, include it in a write statement's `RETURNING` clause. Write each batch atomically so there is one transaction ID to wait for. See Neon's [backend mutation examples](https://neon.com/docs/realtime/guides/mutations#returning-the-txid-from-your-backend).

Pass an explicit timeout to `awaitTxId`. Without one, it can wait until the transaction arrives or the collection is cleaned up. Keep waits bounded because TanStack DB holds synced changes while a mutation handler runs. A rejected write or failed wait rolls back the optimistic change.

Once the backend returns a committed txid, a failed wait means the saved write is unconfirmed by sync. `NotSyncedYetError` preserves that distinction: show a saved-but-waiting notice and let sync catch up. Do not automatically retry the write. If your application supports retries after an ambiguous network failure, make backend writes idempotent with a stable request ID or row key.

With the handlers configured, use the collection passed by your session owner. For example, in `addTodo.ts`:

```ts
import { NotSyncedYetError } from './collections'
import type { TodosCollection } from './collections'

export async function addTodo(todosCollection: TodosCollection) {
  const transaction = todosCollection.insert({
    id: crypto.randomUUID(),
    title: 'Try Neon Realtime',
    completed: false,
  })

  try {
    await transaction.when('settled')
    return 'Saved'
  } catch (error) {
    if (error instanceof NotSyncedYetError) {
      return 'Saved. It will appear when live updates reconnect.'
    }
    throw error
  }
}
```

Render the returned notice in your UI and handle other rejections as write errors. Use `todosCollection.update(id, (draft) => { draft.completed = true })` and `todosCollection.delete(id)` for updates and deletes, with the same settlement handling.

An optimistic insert needs a complete row with its final key. Wait for a write to settle successfully before sending another write that depends on it, or disable controls while a row's `$hasPendingWrites` is true. After a `NotSyncedYetError`, wait for sync to show the saved row before sending a dependent write.

## Additional Resources

- [Neon Realtime documentation](https://neon.com/docs/realtime/overview)
- [TanStack DB integration guide](https://neon.com/docs/realtime/guides/reactivity#tanstack-db)
- [TanStack DB SDK reference](https://neon.com/docs/realtime/sdks/typescript#tanstack-db)
- [Optimistic mutations with TanStack DB](https://neon.com/docs/realtime/guides/mutations#with-tanstack-db-collections)
- [TanStack Start example](https://neon.com/docs/realtime/examples/tanstack)
- [Live Queries guide](../guides/live-queries.md)
- [Mutations guide](../guides/mutations.md)
- [Error Handling guide](../guides/error-handling.md)
