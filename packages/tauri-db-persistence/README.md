# @tanstack/tauri-db-persistence

Thin SQLite persistence for Tauri apps using `@tauri-apps/plugin-sql`.

## Public API

- `createTauriSQLitePersistence(...)`
- `persistedCollectionOptions(...)` (re-exported from core)

## Install

```bash
pnpm add @tanstack/tauri-db-persistence @tauri-apps/plugin-sql
```

## Consumer-side Tauri setup

Install the official SQL plugin in your Tauri app:

```bash
cd src-tauri
cargo add tauri-plugin-sql --features sqlite
```

Register the plugin in `src-tauri/src/main.rs`:

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Enable the SQL permissions in `src-tauri/capabilities/default.json`:

```json
{
  "permissions": ["core:default", "sql:default", "sql:allow-execute"]
}
```

## Quick start

```ts
import Database from '@tauri-apps/plugin-sql'
import { createCollection } from '@tanstack/db'
import {
  createTauriSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/tauri-db-persistence'

type Todo = {
  id: string
  title: string
  completed: boolean
}

const database = await Database.load(`sqlite:tanstack-db.sqlite`)

const persistence = createTauriSQLitePersistence({
  database,
})

export const todosCollection = createCollection(
  persistedCollectionOptions<Todo, string>({
    id: `todos`,
    getKey: (todo) => todo.id,
    persistence,
    schemaVersion: 1,
  }),
)
```

## Notes

- `createTauriSQLitePersistence` is shared across collections.
- Reuse a single `Database.load('sqlite:...')` handle per SQLite file when using
  this package. Opening multiple plugin handles to the same file can reintroduce
  SQLite locking behavior outside this package's serialized transaction queue.
- Mode defaults (`sync-present` vs `sync-absent`) are inferred from whether a
  `sync` config is present in `persistedCollectionOptions`.
- This package expects a database handle created by
  `@tauri-apps/plugin-sql`, typically from `Database.load('sqlite:...')`.
- The database path is resolved by Tauri's SQL plugin, not by this package.
- This package does not publish or require package-specific Rust code. Only the
  app-level Tauri SQL plugin registration shown above is required.

## Testing

- `pnpm --filter @tanstack/tauri-db-persistence test`
  runs the driver and shared adapter contract tests.
- `pnpm --filter @tanstack/tauri-db-persistence test:e2e`
  builds the repo-local Tauri harness and runs the persisted collection
  conformance suite inside a real Tauri runtime.
