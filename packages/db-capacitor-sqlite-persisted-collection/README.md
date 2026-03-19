# @tanstack/db-capacitor-sqlite-persisted-collection

Thin SQLite persistence for Capacitor apps using
`@capacitor-community/sqlite`.

## Public API

- `createCapacitorSQLitePersistence(...)`
- `persistedCollectionOptions(...)` (re-exported from core)

## Install

```bash
pnpm add @tanstack/db-capacitor-sqlite-persisted-collection @capacitor-community/sqlite
```

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

## Platform notes

- `createCapacitorSQLitePersistence` is shared across collections.
- Mode defaults (`sync-present` vs `sync-absent`) are inferred from whether a
  `sync` config is present in `persistedCollectionOptions`.
- This package assumes you provide an already-created and opened
  `SQLiteDBConnection`.
- Calling `close()` on this driver's database adapter closes the underlying
  `SQLiteDBConnection`, so treat driver ownership as connection ownership.
- This package targets native Capacitor runtimes. Use the dedicated browser and
  Electron persistence packages instead of the plugin's web or Electron modes.
- The plugin's database version and upgrade APIs are separate from TanStack DB
  `schemaVersion`.
- `@capacitor-community/sqlite` uses SQLCipher-backed native builds, so app
  setup may require additional platform configuration outside this package.
- Capacitor 8 creates iOS projects with Swift Package Manager by default, but
  `@capacitor-community/sqlite` currently links through CocoaPods on iOS. Add
  iOS with `npx cap add ios --packagemanager CocoaPods`, or recreate an SPM
  project in CocoaPods mode before expecting the native plugin to load.

## Testing

- `pnpm --filter @tanstack/db-capacitor-sqlite-persisted-collection test:e2e`
  runs the package e2e suite against the default `better-sqlite3` harness.
- `pnpm --filter @tanstack/db-capacitor-sqlite-persisted-collection test:e2e:ios`
  builds the package-local Capacitor harness in `e2e/app`, launches the iOS
  simulator, and runs the full persisted collection e2e suite inside the real
  native Capacitor runtime.
- `pnpm --filter @tanstack/db-capacitor-sqlite-persisted-collection test:e2e:android`
  builds the same package-local Capacitor harness in `e2e/app`, launches an
  Android emulator or uses a connected debug target, and runs the full
  persisted collection e2e suite inside the real native Capacitor runtime.
- `test:e2e:ios` is a repo-local validation path for this package. It depends on
  the checked-in `e2e/app` harness plus local Capacitor/Xcode tooling.
- `test:e2e:android` depends on a local Android SDK. The runner auto-detects the
  default macOS SDK location, boots the first available AVD when needed, and
  reads the app-owned SQLite result database out of the debug sandbox with
  `adb run-as`.
- The native harness lives under `e2e/app` so the same app can be extended to
  other native targets later, including Android.
