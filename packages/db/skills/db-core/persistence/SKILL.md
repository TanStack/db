---
name: db-core/persistence
description: >
  SQLite-backed persistence for TanStack DB collections. persistedCollectionOptions
  wraps any adapter (Electric, Query, PowerSync, or local-only) with durable local
  storage. Platform adapters: browser (WA-SQLite OPFS), React Native (op-sqlite),
  Expo (expo-sqlite), Electron (IPC), Node (better-sqlite3), Capacitor, Tauri,
  Cloudflare Durable Objects. Multi-tab/multi-process coordination via
  BrowserCollectionCoordinator / ElectronCollectionCoordinator /
  SingleProcessCoordinator. schemaVersion for migration resets. Local-only mode
  for offline-first without a server.
type: sub-skill
library: db
library_version: '0.6.0'
sources:
  - 'TanStack/db:packages/db-sqlite-persistence-core/src/persisted.ts'
  - 'TanStack/db:packages/browser-db-sqlite-persistence/src/index.ts'
  - 'TanStack/db:packages/react-native-db-sqlite-persistence/src/index.ts'
  - 'TanStack/db:packages/expo-db-sqlite-persistence/src/index.ts'
  - 'TanStack/db:packages/electron-db-sqlite-persistence/src/index.ts'
  - 'TanStack/db:packages/node-db-sqlite-persistence/src/index.ts'
  - 'TanStack/db:examples/react/offline-transactions/src/db/persisted-todos.ts'
  - 'TanStack/db:examples/react-native/shopping-list/src/db/collections.ts'
---

This skill builds on db-core and db-core/collection-setup. Read those first.

# SQLite Persistence

TanStack DB persistence adds a durable SQLite-backed layer to any collection. Data survives page reloads, app restarts, and offline periods. The server remains authoritative for synced collections -- persistence provides a local cache that hydrates instantly.

## Choosing a Platform Package

| Platform       | Package                                                      | Create function                              |
| -------------- | ------------------------------------------------------------ | -------------------------------------------- |
| Browser (OPFS) | `@tanstack/browser-db-sqlite-persistence`                    | `createBrowserWASQLitePersistence`           |
| React Native   | `@tanstack/react-native-db-sqlite-persistence`               | `createReactNativeSQLitePersistence`         |
| Expo           | `@tanstack/expo-db-sqlite-persistence`                       | `createExpoSQLitePersistence`                |
| Electron       | `@tanstack/electron-db-sqlite-persistence`                   | `createElectronSQLitePersistence` (renderer) |
| Node.js        | `@tanstack/node-db-sqlite-persistence`                       | `createNodeSQLitePersistence`                |
| Capacitor      | `@tanstack/capacitor-db-sqlite-persistence`                  | `createCapacitorSQLitePersistence`           |
| Tauri          | `@tanstack/tauri-db-sqlite-persistence`                      | `createTauriSQLitePersistence`               |
| Cloudflare DO  | `@tanstack/cloudflare-durable-objects-db-sqlite-persistence` | `createCloudflareDOSQLitePersistence`        |

All platform packages re-export `persistedCollectionOptions` from the core.

## Local-Only Persistence (No Server)

For purely local data with no sync backend:

```ts
import { createCollection } from '@tanstack/react-db'
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '@tanstack/browser-db-sqlite-persistence'

const database = await openBrowserWASQLiteOPFSDatabase({
  databaseName: 'my-app.sqlite',
})

const coordinator = new BrowserCollectionCoordinator({
  dbName: 'my-app',
})

const persistence = createBrowserWASQLitePersistence({
  database,
  coordinator,
})

const draftsCollection = createCollection(
  persistedCollectionOptions<Draft, string>({
    id: 'drafts',
    getKey: (d) => d.id,
    persistence,
    schemaVersion: 1,
  }),
)
```

Local-only collections provide `collection.utils.acceptMutations()` for applying mutations directly.

## Synced Persistence (Wrapping an Adapter)

Spread an existing adapter's options into `persistedCollectionOptions` to add persistence on top of sync:

```ts
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import {
  createReactNativeSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/react-native-db-sqlite-persistence'

const persistence = createReactNativeSQLitePersistence({ database })

const todosCollection = createCollection(
  persistedCollectionOptions({
    ...electricCollectionOptions({
      id: 'todos',
      shapeOptions: { url: '/api/electric/todos' },
      getKey: (item) => item.id,
    }),
    persistence,
    schemaVersion: 1,
  }),
)
```

This works with any adapter: `electricCollectionOptions`, `queryCollectionOptions`, `powerSyncCollectionOptions`, etc. The `persistedCollectionOptions` wrapper intercepts the sync layer to persist data as it flows through.

## Multi-Tab / Multi-Process Coordination

Coordinators handle leader election and cross-instance communication so only one tab/process owns the database writer.

| Platform                              | Coordinator                     | Mechanism                                      |
| ------------------------------------- | ------------------------------- | ---------------------------------------------- |
| Browser                               | `BrowserCollectionCoordinator`  | BroadcastChannel + Web Locks                   |
| Electron                              | `ElectronCollectionCoordinator` | IPC (main holds DB, renderer accesses via RPC) |
| Single-process (RN, Expo, Node, etc.) | `SingleProcessCoordinator`      | No-op (always leader)                          |

Browser example:

```ts
import { BrowserCollectionCoordinator } from '@tanstack/browser-db-sqlite-persistence'

const coordinator = new BrowserCollectionCoordinator({
  dbName: 'my-app',
})

// Pass to persistence
const persistence = createBrowserWASQLitePersistence({ database, coordinator })

// Cleanup on shutdown
coordinator.dispose()
```

Electron requires setup in both processes:

```ts
// Main process
import { exposeElectronSQLitePersistence } from '@tanstack/electron-db-sqlite-persistence'
exposeElectronSQLitePersistence({ persistence, ipcMain })

// Renderer process
import {
  createElectronSQLitePersistence,
  ElectronCollectionCoordinator,
} from '@tanstack/electron-db-sqlite-persistence'

const coordinator = new ElectronCollectionCoordinator({ dbName: 'my-app' })
const persistence = createElectronSQLitePersistence({ ipcRenderer: window.electron.ipcRenderer, coordinator })
```

## Schema Versioning

`schemaVersion` tracks the shape of persisted data. When the stored version doesn't match the code, the collection resets (drops and reloads from server for synced collections, or throws for local-only).

```ts
persistedCollectionOptions({
  // ...
  schemaVersion: 2, // bump when you change the data shape
})
```

There is no custom migration function -- a version mismatch triggers a full reset. For synced collections this is safe because the server re-supplies the data.

## Key Options

| Option          | Type                             | Description                                              |
| --------------- | -------------------------------- | -------------------------------------------------------- |
| `persistence`   | `PersistedCollectionPersistence` | Platform adapter + coordinator                           |
| `schemaVersion` | `number`                         | Data version (default 1). Bump on schema changes         |
| `id`            | `string`                         | Required for local-only. Collection identifier in SQLite |

## Common Mistakes

### CRITICAL Using local-only persistence without an `id`

Wrong:

```ts
persistedCollectionOptions({
  getKey: (d) => d.id,
  persistence,
  // missing id — generates random UUID each session, data won't persist across reloads
})
```

Correct:

```ts
persistedCollectionOptions({
  id: 'drafts',
  getKey: (d) => d.id,
  persistence,
})
```

Without an explicit `id`, the code generates a random UUID each session, so persisted data is silently abandoned on every reload. Local-only persisted collections must always provide an `id`. Synced collections derive it from the adapter config.

### HIGH Forgetting the coordinator in multi-tab apps

Wrong:

```ts
const persistence = createBrowserWASQLitePersistence({ database })
// No coordinator — concurrent tabs corrupt the database
```

Correct:

```ts
const coordinator = new BrowserCollectionCoordinator({ dbName: 'my-app' })
const persistence = createBrowserWASQLitePersistence({ database, coordinator })
```

Without a coordinator, multiple browser tabs write to SQLite concurrently, causing data corruption. Always use `BrowserCollectionCoordinator` in browser environments.

### HIGH Not bumping schemaVersion after changing data shape

If you add, remove, or rename fields in your collection type but keep the same `schemaVersion`, the persisted SQLite data will have the old shape. For synced collections, bump the version to trigger a reset and re-sync.

### MEDIUM Not disposing the coordinator on cleanup

```ts
// On app shutdown or hot module reload
coordinator.dispose()
await database.close?.()
```

Failing to dispose leaks BroadcastChannel subscriptions and Web Lock handles.

See also: db-core/collection-setup/SKILL.md — for adapter selection and collection configuration.

See also: offline/SKILL.md — for offline transaction queueing (complements persistence).
