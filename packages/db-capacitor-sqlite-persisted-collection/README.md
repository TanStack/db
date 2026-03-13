# @tanstack/db-capacitor-sqlite-persisted-collection

Thin SQLite persistence for Capacitor apps using
`@capacitor-community/sqlite`.

## Public API

- `createCapacitorSQLitePersistence(...)`
- `persistedCollectionOptions(...)` (re-exported from core)

## Quick start

```ts
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import { createCollection } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import {
  createCapacitorSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/db-capacitor-sqlite-persisted-collection'

type Todo = {
  id: string
  title: string
  completed: boolean
}

const sqlite = new SQLiteConnection(CapacitorSQLite)
const database = await sqlite.createConnection(
  `tanstack-db`,
  false,
  `no-encryption`,
  1,
  false,
)

await database.open()

// One shared persistence instance for the whole database.
const persistence = createCapacitorSQLitePersistence({
  database,
})
const queryClient = new QueryClient()

export const todosCollection = createCollection(
  persistedCollectionOptions<Todo, string>({
    ...queryCollectionOptions({
      queryKey: [`todos`],
      queryFn: async () => {
        const response = await fetch(`/api/todos`)
        return response.json() as Promise<Array<Todo>>
      },
      queryClient,
      getKey: (todo) => todo.id,
    }),
    id: `todos`,
    persistence,
    schemaVersion: 1, // Per-collection schema version
  }),
)
```

## Notes

- `createCapacitorSQLitePersistence` is shared across collections.
- Mode defaults (`sync-present` vs `sync-absent`) are inferred from whether a
  `sync` config is present in `persistedCollectionOptions`.
- This package assumes you provide an already-created and opened
  `SQLiteDBConnection`.
- This package targets native Capacitor runtimes. Use the dedicated browser and
  Electron persistence packages instead of the plugin's web or Electron modes.
- The plugin's database version and upgrade APIs are separate from TanStack DB
  `schemaVersion`.
- `@capacitor-community/sqlite` uses SQLCipher-backed native builds, so app
  setup may require additional platform configuration outside this package.
