# @tanstack/db-react-native-sqlite-persisted-collection

Thin SQLite persistence for React Native apps (including Expo runtime).

## Public API

- `createReactNativeSQLitePersistence(...)`
- `persistedCollectionOptions(...)` (re-exported from core)

## Quick start

```ts
import { open } from '@op-engineering/op-sqlite'
import { createCollection } from '@tanstack/db'
import {
  createReactNativeSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/db-react-native-sqlite-persisted-collection'

type Todo = {
  id: string
  title: string
  completed: boolean
}

const database = open({
  name: `tanstack-db.sqlite`,
  location: `default`,
})

// One shared persistence instance for the whole database.
const persistence = createReactNativeSQLitePersistence({
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

- The same API is used for React Native and Expo runtimes.
- `createReactNativeSQLitePersistence` is shared across collections.
- Mode defaults (`sync-present` vs `sync-absent`) are inferred from whether a
  `sync` config is present in `persistedCollectionOptions`.
