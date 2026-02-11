# @tanstack/db-electron-sqlite-persisted-collection

Thin Electron bridge for TanStack DB SQLite persistence.

## Public API

- `exposeElectronSQLitePersistence(...)` (main process)
- `createElectronSQLitePersistence(...)` (renderer process)
- `persistedCollectionOptions(...)` (re-exported from core)

Use `@tanstack/db-electron-sqlite-persisted-collection/main` and
`@tanstack/db-electron-sqlite-persisted-collection/renderer` if you prefer
explicit process-specific entrypoints.

## Main process

```ts
import { ipcMain } from 'electron'
import {
  BetterSqlite3SQLiteDriver,
  createNodeSQLitePersistence,
} from '@tanstack/db-node-sqlite-persisted-collection'
import { exposeElectronSQLitePersistence } from '@tanstack/db-electron-sqlite-persisted-collection/main'

const driver = new BetterSqlite3SQLiteDriver({
  filename: `./tanstack-db.sqlite`,
})

const persistence = createNodeSQLitePersistence({
  driver,
})

const dispose = exposeElectronSQLitePersistence({
  ipcMain,
  persistence,
})

// Call dispose() and driver.close() during shutdown.
```

## Renderer process

```ts
import { createCollection } from '@tanstack/db'
import { ipcRenderer } from 'electron'
import {
  createElectronSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/db-electron-sqlite-persisted-collection'

type Todo = {
  id: string
  title: string
  completed: boolean
}

const persistence = createElectronSQLitePersistence<Todo, string>({
  ipcRenderer,
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

## Notes

- The renderer API mirrors other runtimes: one shared `create...Persistence`.
- Collection mode (`sync-present` vs `sync-absent`) and `schemaVersion` are
  resolved per collection and forwarded across IPC automatically.
