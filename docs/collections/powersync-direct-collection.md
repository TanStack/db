---
title: PowerSync In-Memory Collection
---

PowerSync in-memory collections integrate TanStack DB with [PowerSync](https://powersync.com) without a local SQLite database. Collections are backed directly by PowerSync [Sync Streams](https://docs.powersync.com/sync/streams/overview), giving you a lightweight, real-time sync integration for web apps.

> [!TIP]
> This documents `@tanstack/powersync-direct-collection`, which is based on a JavaScript implementation of the PowerSync protocol.
> If you need offline-ready persistence, use the [PowerSync SQLite collection](./powersync-collection.md) instead.

## Overview

The `@tanstack/powersync-direct-collection` package allows you to create collections that:

- Reactively update when PowerSync records change
- Integrate deeply with [Sync Streams](https://docs.powersync.com/sync/streams/overview), subscribing eagerly or only for the data that live queries need
- Leverage PowerSync's built-in [consistency guarantees](https://docs.powersync.com/architecture/consistency)
- Enable real-time synchronization with PostgreSQL, MongoDB, MySQL or SQL Server backends

Compared to the [SQLite-based collection](./powersync-collection.md) (which is 1MB+ including WebAssembly modules and workers), this option is much more lightweight. 
As all data is kept in memory, it is a good fit when all of the following apply:

- You're syncing small data sizes that can be fetched every time the page is opened.
- You don't need offline persistence
- You don't need local multi-tab support (other tabs see writes after they've been uploaded and synced down again).
- Fast load times and minimal code size are critical.

## 1. Installation

Install the PowerSync collection package. As it uses a JavaScript implementation instead of SQLite, no other PowerSync SDK is required.

```bash
npm install @tanstack/powersync-direct-collection @tanstack/react-db
```

The package uses recent JavaScript features and targets modern browsers, Node.js and other modern runtimes. Runtimes like React Native are not supported without transformations and polyfills.

## 2. Connect to PowerSync

Create one `PowerSyncClient` for your app. All collections created with the same client share one connection to the PowerSync Service.

```ts
import { PowerSyncClient } from '@tanstack/powersync-direct-collection'

export const powerSync = new PowerSyncClient({
  endpoint: 'https://<your-instance>.powersync.journeyapps.com',
  // Called whenever the client (re)connects. Return a PowerSync JWT for the current user.
  getToken: async (signal) => {
    const response = await fetch('/api/powersync-token', { signal })
    return (await response.json()).token
  },
})
```

The client connects once a collection is queried, and disconnects automatically once no subscribed PowerSync connections remain.
See [authentication](https://docs.powersync.com/configuration/auth/overview) for how to issue tokens.

## 3. Create a Collection

Each collection holds the rows of one PowerSync table. Use `streams` to choose which Sync Streams to subscribe to while the collection is in use:

```ts
import { createCollection } from '@tanstack/react-db'
import { powerSyncCollectionOptions } from '@tanstack/powersync-direct-collection'
import { z } from 'zod'

const Todo = z.object({
  id: z.string(),
  list_id: z.string(),
  description: z.string(),
  completed: z.coerce.boolean(),
})
type Todo = z.infer<typeof Todo>

export const todos = createCollection(
  powerSyncCollectionOptions<Todo>({
    client: powerSync,
    table: 'todos',
    // Name of the Sync Stream to subscribe to when loading the collection.
    streams: [{ name: 'user_todos' }],
    // Converts synced JSON rows into your application type.
    parse: (row) => Todo.parse(row),
  }),
)
```

`parse` receives each synced row. It must return a value with the same `id`. Use it to validate rows and convert values, for example to turn integers into booleans or ISO strings into dates.

Streams can take [parameters](https://docs.powersync.com/sync/streams/parameters), and an optional [priority override](https://docs.powersync.com/sync/streams/client-usage#priority-override):

```ts
streams: [{ name: 'list_todos', parameters: { list_id: listId }, priority: 1 }]
```

A collection includes **all** synced rows of its table, whichever collection requested the stream they came from. A collection that only displays rows synced through other collections can leave `streams` empty. Filtering happens in your TanStack DB queries.

## Querying

Collections work with all TanStack DB query APIs. In React:

```tsx
import { useLiveQuery, eq } from '@tanstack/react-db'

function TodoList({ listId }: { listId: string }) {
  const { data, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ todo: todos })
        .where(({ todo }) => eq(todo.list_id, listId))
        .orderBy(({ todo }) => todo.description),
    [listId],
  )

  if (isLoading) return <p>Loading…</p>
  return (
    <ul>
      {data.map((todo) => (
        <li key={todo.id}>{todo.description}</li>
      ))}
    </ul>
  )
}
```

A collection becomes ready once the PowerSync Service has sent a complete, consistent snapshot of its streams. Updates are then applied as they arrive.

## On-Demand Sync

For larger datasets, you can subscribe to streams only for the data that live queries actually need. Pass `getSubscriptions` instead of `streams`. TanStack DB calls it with each query's filters, and the subscription lasts as long as the query is active.

For example, with Sync Stream defined as:

```yaml
streams:
  list_todos:
    query: SELECT * FROM todos WHERE list_id = subscription.parameter('list_id')
```

A client can subscribe with relevant parameters:

```ts
import { createCollection, parseLoadSubsetOptions } from '@tanstack/react-db'

export const todos = createCollection(
  powerSyncCollectionOptions<Todo>({
    client: powerSync,
    table: 'todos',
    parse: (row) => Todo.parse(row),
    getSubscriptions: (options) => {
      const { filters } = parseLoadSubsetOptions(options)
      const list = filters.find(
        (f) => f.field.join('.') === 'list_id' && f.operator === 'eq',
      )
      return list
        ? [{ name: 'list_todos', parameters: { list_id: list.value } }]
        : []
    },
  }),
)
```

A live query on an on-demand collection is ready once the streams it requested have synced. Queries using the same stream and parameters share one subscription. `parseLoadSubsetOptions` also exposes the query's sorts and limit if your streams need them.

## Writing Data

PowerSync syncs data from your backend database to clients. Writes are your responsibility: TanStack DB applies them optimistically and calls your mutation handlers to upload them to your backend. After your backend has committed a write to the source database, call `confirmWrites()`. It waits until PowerSync has synced the change back, so the optimistic state is replaced with confirmed data without flickering:

```ts
export const todos = createCollection(
  powerSyncCollectionOptions<Todo>({
    client: powerSync,
    table: 'todos',
    streams: [{ name: 'user_todos' }],
    parse: (row) => Todo.parse(row),
    onInsert: async ({ transaction, collection }) => {
      await api.createTodos(transaction.mutations.map((m) => m.modified))
      await collection.utils.confirmWrites()
    },
    onUpdate: async ({ transaction, collection }) => {
      await api.updateTodos(
        transaction.mutations.map((m) => ({ id: m.key, ...m.changes })),
      )
      await collection.utils.confirmWrites()
    },
    onDelete: async ({ transaction, collection }) => {
      await api.deleteTodos(transaction.mutations.map((m) => m.key))
      await collection.utils.confirmWrites()
    },
  }),
)

// Then, anywhere in your app:
todos.insert({
  id: crypto.randomUUID(),
  list_id: listId,
  description: 'Buy milk',
  completed: false,
})
```

If a handler throws, TanStack DB rolls back the optimistic state. `confirmWrites()` is also available as `powerSync.confirmWrites()`. Both accept an `AbortSignal` to stop waiting: `confirmWrites({ signal: AbortSignal.timeout(10_000) })`.

## Connection Status

`powerSync.status` describes the connection. Its `state` is one of `idle`, `connecting`, `syncing`, `ready` or `retrying`, and `error` holds the last error while retrying. Use `powerSync.subscribeStatus(listener)` to get notified of changes. In React, use the `usePowerSyncStatus` hook from `@powersync/standalone-client/react` (install `@powersync/standalone-client` to import it directly):

```tsx
import { usePowerSyncStatus } from '@powersync/standalone-client/react'

function ConnectionIndicator() {
  const status = usePowerSyncStatus(powerSync)
  return status.state === 'retrying' ? (
    <p>Reconnecting… ({status.error?.message})</p>
  ) : null
}
```

The status describes the connection, not whether a collection has usable data. Use TanStack DB's readiness flags, such as `isLoading` from `useLiveQuery`, for that.

## Errors

Errors surface through TanStack DB's collection status and `health` tree. See [Loading and Sync Errors](../guides/error-handling.md#loading-and-sync-errors) for how to display them.

- If the PowerSync Service rejects a stream subscription, for example because of invalid parameters, the error is a `StreamError`. Its `stream` and `messages` fields describe the problem. A collection whose stream fails before it becomes ready moves to the `error` status, and an on-demand query depending on the stream fails to load. A stream error after that is reported as a `failureReason` while the rows stay available.
- Connection errors after the collection is ready are reported as a `failureReason` as well, and the client keeps retrying with exponential backoff. The `failureReason` clears once sync works again.
- If `parse` throws, the collection can no longer stay consistent with the synced data, so it moves to the `error` status. Make sure your backend only produces rows that `parse` accepts.

## Configuration Options

| Option             | Required    | Description                                                                                       |
| ------------------ | ----------- | ------------------------------------------------------------------------------------------------- |
| `client`           | Yes         | The shared `PowerSyncClient`.                                                                     |
| `table`            | Yes         | The PowerSync table whose rows the collection holds.                                              |
| `parse`            | Yes         | Converts a synced JSON row (including `id`) into the collection's row type.                       |
| `streams`          | No          | Sync Streams to subscribe to while the collection syncs (eager mode).                             |
| `getSubscriptions` | No          | Maps a query's load options to Sync Streams (on-demand mode). Cannot be combined with `streams`.  |
| `id`               | No          | Unique identifier for the collection.                                                             |
| `onInsert`, `onUpdate`, `onDelete` | No | Mutation handlers that upload writes to your backend.                                   |
