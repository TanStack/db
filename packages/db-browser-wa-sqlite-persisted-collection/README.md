# @tanstack/db-browser-wa-sqlite-persisted-collection

Thin browser SQLite persistence for TanStack DB using `wa-sqlite` + OPFS.

## Public API

- `createBrowserWASQLitePersistence(...)`
- `openBrowserWASQLiteOPFSDatabase(...)`
- `persistedCollectionOptions(...)` (re-exported from core)

## Quick start

```ts
import { createCollection } from '@tanstack/db'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '@tanstack/db-browser-wa-sqlite-persisted-collection'

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

## Notes

- This package is Phase 7 single-tab browser wiring: it uses
  `SingleProcessCoordinator` semantics by default.
- Single-tab mode does not require BroadcastChannel or Web Locks for
  correctness.
- OPFS capability failures are surfaced as `PersistenceUnavailableError`.
