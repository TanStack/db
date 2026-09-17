# @tanstack/browser-db-sqlite-persistence

Browser SQLite persistence for TanStack DB using `wa-sqlite` + OPFS.

Supports both single-tab (default) and multi-tab usage. Multi-tab coordination
is opt-in by passing a `BrowserCollectionCoordinator`.

## Public API

- `createBrowserWASQLitePersistence(...)`
- `openBrowserWASQLiteOPFSDatabase(...)`
- `persistedCollectionOptions(...)` (re-exported from core)

## Quick start (single-tab)

By default, `createBrowserWASQLitePersistence` uses `SingleProcessCoordinator`
semantics — no leader election, no `BroadcastChannel`, no Web Locks. This is
the right choice when your app is only ever open in one tab at a time, or when
each tab uses its own database.

```ts
import { createCollection } from '@tanstack/db'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '@tanstack/browser-db-sqlite-persistence'

type Todo = {
  id: string
  title: string
  completed: boolean
}

const database = await openBrowserWASQLiteOPFSDatabase({
  databaseName: `tanstack-db.sqlite`,
})

const persistence = createBrowserWASQLitePersistence({
  database,
})

export const todosCollection = createCollection(
  persistedCollectionOptions<Todo, string>({
    id: `todos`,
    getKey: (todo) => todo.id,
    persistence,
    schemaVersion: 1, // Per-collection schema version
  }),
)
```

## Multi-tab usage

To safely share a single OPFS database across multiple tabs of the same
origin, pass a `BrowserCollectionCoordinator` via the `coordinator` option.
The coordinator uses the Web Locks API to elect a leader tab, and
`BroadcastChannel` to fan out committed transactions to follower tabs.
Follower tabs forward writes to the leader via RPC over the channel.

```ts
import { createCollection } from '@tanstack/db'
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '@tanstack/browser-db-sqlite-persistence'

const database = await openBrowserWASQLiteOPFSDatabase({
  databaseName: `tanstack-db.sqlite`,
})

const coordinator = new BrowserCollectionCoordinator({
  dbName: `tanstack-db`,
})

const persistence = createBrowserWASQLitePersistence({
  database,
  coordinator,
})

export const todosCollection = createCollection(
  persistedCollectionOptions<Todo, string>({
    id: `todos`,
    getKey: (todo) => todo.id,
    persistence,
    schemaVersion: 1,
  }),
)

// On teardown:
// coordinator.dispose()
// await database.close?.()
```

See [`examples/react/offline-transactions`](../../examples/react/offline-transactions/src/db/persisted-todos.ts)
for a full multi-tab example.

## Notes

- `openBrowserWASQLiteOPFSDatabase(...)` starts a dedicated Web Worker and
  routes SQL operations through it. OPFS sync access handle APIs are used in
  that worker context.
- Single-tab mode does not require `BroadcastChannel` or Web Locks for
  correctness.
- Multi-tab mode requires `BroadcastChannel` and the Web Locks API; both are
  available in all modern browsers.
- OPFS capability failures are surfaced as `PersistenceUnavailableError`.
