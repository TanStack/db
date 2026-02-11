# @tanstack/db-react-native-sqlite-persisted-collection

React Native and Expo SQLite persistence wrappers for TanStack DB, built on the shared
`@tanstack/db-sqlite-persisted-collection-core` adapter.

## Entrypoints

- `@tanstack/db-react-native-sqlite-persisted-collection` (shared APIs)
- `@tanstack/db-react-native-sqlite-persisted-collection/react-native`
- `@tanstack/db-react-native-sqlite-persisted-collection/expo`

## Exported API (complete)

### Root entrypoint (`.`)

#### op-sqlite driver APIs

- `OpSQLiteDatabaseLike`
- `OpSQLiteDriverOptions`
- `OpSQLiteDriver`
- `createOpSQLiteDriver(...)`

#### Mobile persistence APIs

- `MobileSQLitePersistenceAdapterOptions`
- `MobileSQLitePersistenceOptions`
- `MobileSQLitePersistenceAdapter<T, TKey>`
- `createMobileSQLitePersistenceAdapter<T, TKey>(...)`
- `createMobileSQLitePersistence<T, TKey>(...)`

#### React Native alias APIs

- `ReactNativeSQLitePersistenceAdapterOptions`
- `ReactNativeSQLitePersistenceOptions`
- `createReactNativeSQLitePersistenceAdapter<T, TKey>(...)`
- `createReactNativeSQLitePersistence<T, TKey>(...)`

#### Expo alias APIs

- `ExpoSQLitePersistenceAdapterOptions`
- `ExpoSQLitePersistenceOptions`
- `createExpoSQLitePersistenceAdapter<T, TKey>(...)`
- `createExpoSQLitePersistence<T, TKey>(...)`

#### Re-exported core APIs

This package re-exports **all** exports from
`@tanstack/db-sqlite-persisted-collection-core` at the root entrypoint
(including `persistedCollectionOptions` and core types/errors).

### `./react-native` entrypoint

- `ReactNativeSQLitePersistenceAdapterOptions`
- `ReactNativeSQLitePersistenceOptions`
- `createReactNativeSQLitePersistenceAdapter<T, TKey>(...)`
- `createReactNativeSQLitePersistence<T, TKey>(...)`

### `./expo` entrypoint

- `ExpoSQLitePersistenceAdapterOptions`
- `ExpoSQLitePersistenceOptions`
- `createExpoSQLitePersistenceAdapter<T, TKey>(...)`
- `createExpoSQLitePersistence<T, TKey>(...)`

## React Native setup (bare app)

```ts
import { open } from '@op-engineering/op-sqlite'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '@tanstack/db-react-native-sqlite-persisted-collection'
import { createReactNativeSQLitePersistence } from '@tanstack/db-react-native-sqlite-persisted-collection/react-native'

type Todo = {
  id: string
  title: string
  completed: boolean
}

const database = open({
  name: 'tanstack-db.sqlite',
  location: 'default',
})

const persistence = createReactNativeSQLitePersistence<Todo, string>({
  driver: {
    database,
  },
})

export const todosCollection = createCollection(
  persistedCollectionOptions<Todo, string>({
    id: `todos`,
    getKey: (todo) => todo.id,
    persistence,
  }),
)
```

## Expo setup (managed workflow)

```ts
import { open } from '@op-engineering/op-sqlite'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '@tanstack/db-react-native-sqlite-persisted-collection'
import { createExpoSQLitePersistence } from '@tanstack/db-react-native-sqlite-persisted-collection/expo'

type Todo = {
  id: string
  title: string
  completed: boolean
}

const database = open({
  name: 'tanstack-db.sqlite',
  location: 'default',
})

const persistence = createExpoSQLitePersistence<Todo, string>({
  driver: {
    database,
  },
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

- Provide either an existing `op-sqlite` database object or an `openDatabase` factory.
- The package defaults to `SingleProcessCoordinator`, matching typical RN/Expo runtime semantics.
- Shared contract and conformance suites are wired in this package to validate behavior parity with node/electron wrappers.
- Both React Native and Expo entrypoints run the persisted collection conformance suite.

## Optional real-runtime test factory

By default, test helpers use a `better-sqlite3`-backed `op-sqlite` test database for
local Node runs. You can run the same suite against a real runtime adapter by providing a
factory module through environment variables:

- `TANSTACK_DB_MOBILE_SQLITE_FACTORY_MODULE`
- `TANSTACK_DB_MOBILE_SQLITE_FACTORY_EXPORT` (optional, defaults to
  `createMobileSQLiteTestDatabaseFactory`)
- `TANSTACK_DB_MOBILE_REQUIRE_RUNTIME_FACTORY=1` (set automatically by
  `pnpm test:e2e:runtime`; causes setup to fail fast when no runtime factory is provided)

The selected export can either be:

- a database factory function with signature
  `({ filename, resultShape }) => { execute, close, ... }`
- or a zero-arg function that returns that factory (sync or async)

Example runtime lane:

```bash
TANSTACK_DB_MOBILE_SQLITE_FACTORY_MODULE=./path/to/runtime-factory.ts \
pnpm --filter @tanstack/db-react-native-sqlite-persisted-collection test:e2e:runtime
```

If your CI environment can provide a runtime factory module, run
`test:e2e:runtime` in CI to enforce real-runtime validation rather than only the
default Node-hosted mock harness. In this repository, the E2E workflow runs the
runtime lane when `TANSTACK_DB_MOBILE_SQLITE_FACTORY_MODULE` is configured.
Set `TANSTACK_DB_REQUIRE_MOBILE_RUNTIME_LANE=1` to make that lane required for
non-fork runs.
