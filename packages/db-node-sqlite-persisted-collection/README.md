# @tanstack/db-node-sqlite-persisted-collection

Thin Node SQLite persistence for TanStack DB.

## Public API

- `BetterSqlite3SQLiteDriver`
- `createNodeSQLitePersistence(...)`
- `persistedCollectionOptions(...)` (re-exported from core)

## Quick start

```ts
import { createCollection } from '@tanstack/db'
import {
  BetterSqlite3SQLiteDriver,
  createNodeSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/db-node-sqlite-persisted-collection'

type Todo = {
  id: string
  title: string
  completed: boolean
}

// You own driver lifecycle directly.
const driver = new BetterSqlite3SQLiteDriver({
  filename: `./tanstack-db.sqlite`,
})

// One shared persistence instance for the whole database.
const persistence = createNodeSQLitePersistence({
  driver,
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

- `createNodeSQLitePersistence` is shared across collections; it resolves
  mode-specific behavior (`sync-present` vs `sync-absent`) automatically.
- `schemaVersion` is specified per collection via `persistedCollectionOptions`.
- Call `driver.close()` when your app shuts down.
