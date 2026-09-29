# @tanstack/electron-db-sqlite-persistence

Thin Electron bridge for TanStack DB SQLite persistence.

## Public API

- `exposeElectronSQLitePersistence(...)` (main process)
- `createElectronSQLitePersistence(...)` (renderer process)
- `ElectronCollectionCoordinator`
- `persistedCollectionOptions(...)` (re-exported from core)

Use `@tanstack/electron-db-sqlite-persistence/main` and
`@tanstack/electron-db-sqlite-persistence/renderer` if you prefer
explicit process-specific entrypoints.

## Main process

```ts
import { ipcMain } from 'electron'
import { createNodeSQLitePersistence } from '@tanstack/node-db-sqlite-persistence'
import { exposeElectronSQLitePersistence } from '@tanstack/electron-db-sqlite-persistence/main'
import Database from 'better-sqlite3'

const database = new Database(`./tanstack-db.sqlite`)

const persistence = createNodeSQLitePersistence({
  database,
})

const dispose = exposeElectronSQLitePersistence({
  ipcMain,
  persistence,
})

// Call dispose() and database.close() during shutdown.
```

## Renderer process

```ts
import { createCollection } from '@tanstack/db'
import { ipcRenderer } from 'electron'
import {
  createElectronSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/electron-db-sqlite-persistence'

type Todo = {
  id: string
  title: string
  completed: boolean
}

const persistence = createElectronSQLitePersistence<Todo, string>({
  ipcRenderer,
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

## Multi-renderer ownership

Pass an `ElectronCollectionCoordinator` when multiple renderers share the same
database. Coordinators using the same `dbName` elect a writer independently for
each collection.

```ts
import {
  ElectronCollectionCoordinator,
  createElectronSQLitePersistence,
} from '@tanstack/electron-db-sqlite-persistence'

const coordinator = new ElectronCollectionCoordinator({
  dbName: `tanstack-db`,
})

const persistence = createElectronSQLitePersistence({
  ipcRenderer,
  coordinator,
})

// On teardown:
// coordinator.dispose()
```

The persisted sync wrapper routes every source transaction with durable effects
through the coordinator's required
`requestApplyCommittedTx(collectionId, tx)` method. The elected renderer applies
the complete `PersistedTx` through its resolved per-collection renderer adapter,
which forwards it over IPC to the main-process persistence owner. Resolution
remains specific to the collection id, mode, and `schemaVersion`.

Truncation, row changes, row metadata, collection metadata, and stream position
stay in the same transaction. Electron does not feature-detect a partial route
or fall back to row-only mutation RPC. A custom coordinator that omits
`requestApplyCommittedTx` is rejected while the collection is configured,
before its sync source can publish rows. An effect-free source commit neither
publishes nor consumes a coordinator sequence.

If a mutating RPC loses its response, Electron coordination replays it only
while the requester still knows the same non-null leader id and term. An
unknown initial route or any leader/term change rejects with
`IndeterminateCommitError`; the application must reconcile the outcome. The
coordinator does not retry that mutation against an unknown or replacement
leader.

Remote-subset requests use the same crash-only boundary. The coordinator
projects a live `LoadSubsetOptions` input to the exported
`TransportedLoadSubsetOptions` type before either local completion or renderer
transport. Live `signal` and `subscription` fields do not cross the boundary.
Unsupported nested values throw `RemoteSubsetWireValueError` with the exact
value path before publication; Electron does not add codecs, coercion, or a
fallback representation.

Electron uses the same explicit lease lifecycle as Browser coordination. The
same request object reuses one acquisition identity, distinct equal objects
remain independent, and release unloads the exact transported options once.
Leadership loss unloads the retiring renderer's leases; still-live requester
leases replay against the next leader. A second owner registration for one
collection throws `DuplicateRemoteSubsetOwnerError`, and there is no adapter
fallback for a missing owner. Remote follower transport/admission failures
reject and retain demand for its normal retry without entering the follower's
local owner lifecycle. Terminal release identities expire after the existing
RPC dedupe horizon while delayed duplicates inside that horizon remain
idempotent.

## Notes

- The renderer API mirrors other runtimes: one shared `create...Persistence`.
- Collection mode (`sync-present` vs `sync-absent`) and `schemaVersion` are
  resolved per collection and forwarded across IPC automatically.
- Without an `ElectronCollectionCoordinator`, single-renderer mode uses
  `SingleProcessCoordinator`: it is always leader, but still routes complete
  transactions to the collection's resolved IPC adapter.
