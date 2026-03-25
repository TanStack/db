# @tanstack/expo-db-persistence

Thin SQLite persistence for Expo apps using the official `expo-sqlite` adapter.

## Public API

- `createExpoSQLitePersistence(...)`
- `persistedCollectionOptions(...)` (re-exported from core)
- Advanced driver entrypoint:
  `@tanstack/expo-db-persistence/expo-sqlite-driver`

## Quick start

```ts
import * as SQLite from 'expo-sqlite'
import { createCollection } from '@tanstack/db'
import {
  createExpoSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/expo-db-persistence'

type Todo = {
  id: string
  title: string
  completed: boolean
}

const database = await SQLite.openDatabaseAsync(`tanstack-db.sqlite`)

// One shared persistence instance for the whole database.
const persistence = createExpoSQLitePersistence({
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

- This package targets the official `expo-sqlite` async database API.
- Requires `expo-sqlite` `^55.0.10` (documented as a peer dependency).
- `createExpoSQLitePersistence` is shared across collections.
- Mode defaults (`sync-present` vs `sync-absent`) are inferred from whether a
  `sync` config is present in `persistedCollectionOptions`.
- The React Native `op-sqlite` wrapper remains available in
  `@tanstack/react-native-db-persistence`.
- Expo web is not part of the emulator-backed E2E path in this package. Use the
  browser SQLite package for browser-focused persistence coverage.

## E2E

- `pnpm --filter @tanstack/expo-db-persistence test:e2e`
  runs the shared Node-backed conformance suite.
- `pnpm --filter @tanstack/expo-db-persistence test:e2e:expo:ios`
  runs the real Expo iOS Simulator path.
- `pnpm --filter @tanstack/expo-db-persistence test:e2e:expo:android`
  runs the real Expo Android Emulator path.
