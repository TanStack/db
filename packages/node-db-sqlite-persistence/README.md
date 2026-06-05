# @tanstack/node-db-sqlite-persistence

Thin Node SQLite persistence for TanStack DB.

## Public API

- `createNodeSQLitePersistence(...)`
- `persistedCollectionOptions(...)` (re-exported from core)

## Quick start

```ts
import { createCollection } from '@tanstack/db'
import {
  createNodeSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/node-db-sqlite-persistence'
import Database from 'better-sqlite3'

type Todo = {
  id: string
  title: string
  completed: boolean
}

// You own database lifecycle directly.
const database = new Database(`./tanstack-db.sqlite`)

// One shared persistence instance for the whole database.
const persistence = createNodeSQLitePersistence({
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

- `createNodeSQLitePersistence` is shared across collections; it resolves
  mode-specific behavior (`sync-present` vs `sync-absent`) automatically.
- `schemaVersion` is specified per collection via `persistedCollectionOptions`.
- Call `database.close()` when your app shuts down.

## Applied transaction pruning

The `applied_tx` log is a replayable cache, so it is pruned by default to keep
the SQLite file from growing without bound. When you don't pass prune options,
the node driver applies:

- `appliedTxPruneMaxRows: 1_000` (per-collection row cap)
- `appliedTxPruneMaxAgeSeconds: 86_400` (24h age backstop)

Pruning runs inside each write transaction, so every collection self-trims on
its next sync. Override either value to tune retention, or pass `0` to disable
that limit:

```ts
const persistence = createNodeSQLitePersistence({
  database,
  appliedTxPruneMaxRows: 5_000, // higher row cap
  appliedTxPruneMaxAgeSeconds: 0, // disable the age backstop
})
```

The defaults are exported as `DEFAULT_APPLIED_TX_PRUNE_MAX_ROWS` and
`DEFAULT_APPLIED_TX_PRUNE_MAX_AGE_SECONDS`.
