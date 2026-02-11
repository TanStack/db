# @tanstack/db-node-sqlite-persisted-collection

Node.js SQLite persisted collection adapters for TanStack DB, using
`better-sqlite3` by default.

## Exported API (complete)

### Node-specific APIs

- `BetterSqlite3Database`
- `BetterSqlite3OpenOptions`
- `BetterSqlite3DriverOptions`
- `BetterSqlite3SQLiteDriver`
- `createBetterSqlite3Driver(...)`
- `NodeSQLitePersistenceAdapterOptions`
- `NodeSQLitePersistenceOptions`
- `createNodeSQLitePersistenceAdapter<T, TKey>(...)`
- `createNodeSQLitePersistence<T, TKey>(...)`

### Re-exported core APIs

This package re-exports **all** exports from
`@tanstack/db-sqlite-persisted-collection-core` at the root entrypoint.
See that package README for the full core symbol list.

## Quick start

```ts
import { createCollection } from '@tanstack/db'
import {
  createBetterSqlite3Driver,
  createNodeSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/db-node-sqlite-persisted-collection'

type Todo = {
  id: string
  title: string
  completed: boolean
}

const driver = createBetterSqlite3Driver({
  filename: `./tanstack-db.sqlite`,
})

const persistence = createNodeSQLitePersistence<Todo, string>({
  driver,
  schemaVersion: 1,
})

export const todosCollection = createCollection(
  persistedCollectionOptions<Todo, string>({
    id: `todos`,
    getKey: (todo) => todo.id,
    persistence,
  }),
)
```

## Notes

- `createBetterSqlite3Driver` accepts either:
  - `{ filename, options?, pragmas? }`
  - `{ database, pragmas? }` for existing `better-sqlite3` handles
- The persistence helper defaults coordinator to `SingleProcessCoordinator`.
- Call `driver.close()` when you own the DB lifecycle.
