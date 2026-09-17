# @tanstack/browser-db-sqlite-persistence

Browser SQLite persistence for TanStack DB using `wa-sqlite` + OPFS.

Supports both single-tab (default) and multi-tab usage. Multi-tab coordination
is opt-in by passing a `BrowserCollectionCoordinator`.

## Public API

- `createBrowserWASQLitePersistence(...)`
- `openBrowserWASQLiteOPFSDatabase(...)`
- `BrowserCollectionCoordinator`
- `persistedCollectionOptions(...)` (re-exported from core)

## Quick start (single-tab)

By default, `createBrowserWASQLitePersistence` uses `SingleProcessCoordinator`
semantics — no leader election, no `BroadcastChannel`, no Web Locks. This is
the right choice when your app is only ever open in one tab at a time, or when
each tab uses its own database.

```ts
import { createCollection } from '@tanstack/db'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '@tanstack/browser-db-sqlite-persistence'

type Todo = {
  id: string
  title: string
  completed: boolean
}

const database = await openBrowserWASQLiteOPFSDatabase({
  databaseName: `tanstack-db.sqlite`,
})

const persistence = createBrowserWASQLitePersistence({
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

## Multi-tab usage

To safely share a single OPFS database across multiple tabs of the same
origin, pass a `BrowserCollectionCoordinator` via the `coordinator` option.
The coordinator uses the Web Locks API to elect a leader tab, and
`BroadcastChannel` to fan out committed transactions to follower tabs.
Follower tabs forward writes to the leader via RPC over the channel.

```ts
import { createCollection } from '@tanstack/db'
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '@tanstack/browser-db-sqlite-persistence'

const database = await openBrowserWASQLiteOPFSDatabase({
  databaseName: `tanstack-db.sqlite`,
})

const coordinator = new BrowserCollectionCoordinator({
  dbName: `tanstack-db`,
})

const persistence = createBrowserWASQLitePersistence({
  database,
  coordinator,
})

export const todosCollection = createCollection(
  persistedCollectionOptions<Todo, string>({
    id: `todos`,
    getKey: (todo) => todo.id,
    persistence,
    schemaVersion: 1,
  }),
)

// On teardown:
// coordinator.dispose()
// await database.close?.()
```

See [`examples/react/offline-transactions`](../../examples/react/offline-transactions/src/db/persisted-todos.ts)
for a full multi-tab example.

### Committed transaction ownership

The persisted sync wrapper sends every source transaction with durable effects
through the coordinator's required
`requestApplyCommittedTx(collectionId, tx)` method.
`BrowserCollectionCoordinator` routes the complete transaction to the current
leader for that collection. The leader applies it with the adapter registered
for the same collection id, including that collection's resolved mode and
`schemaVersion`.

The route preserves truncation, row changes, row metadata, collection metadata,
and stream position as one `PersistedTx`. It does not feature-detect a partial
route or fall back to row-only mutation RPC. A custom coordinator that omits
`requestApplyCommittedTx` is rejected while the collection is configured,
before its sync source can publish rows. An effect-free source commit neither
publishes nor consumes a coordinator sequence.

Single-tab mode uses the same complete transaction contract. Its
`SingleProcessCoordinator` skips election and channel traffic but still routes
the transaction to the resolved adapter for that collection.

If a mutating RPC loses its response, Browser coordination replays it only
while the requester still knows the same non-null leader id and term. An
unknown initial route or any leader/term change rejects with
`IndeterminateCommitError`; the application must reconcile the outcome. The
coordinator does not retry that mutation against an unknown or replacement
leader.

### Remote subset requests

`BrowserCollectionCoordinator.requestEnsureRemoteSubset(...)` validates and
projects the request before it chooses the local leader or `BroadcastChannel`
route. Registered owners receive the exported
`TransportedLoadSubsetOptions` type. It contains the supported
structured-clone wire data and excludes live `signal` and `subscription`
fields. Unsupported nested values fail immediately with
`RemoteSubsetWireValueError` and the exact value path; no owner callback or
channel post occurs. See the core package's remote subset wire contract for the
complete supported domain.

Each accepted request is an explicit lease. Retries of the same request object
reuse its acquisition identity, while distinct equal request objects remain
independent. Release is routed to the elected collection owner and unloads the
exact acquired options once. Leadership loss unloads the retiring owner's live
leases, and requesters replay still-live acquisitions against the next leader.
Registering a second owner for one collection throws
`DuplicateRemoteSubsetOwnerError`; no adapter fallback replaces the owner.
Remote follower transport/admission failures reject and retain demand for its
normal retry without entering the follower's local owner lifecycle. Terminal
release identities expire after the existing RPC dedupe horizon while delayed
duplicates inside that horizon remain idempotent.

## Notes

- `openBrowserWASQLiteOPFSDatabase(...)` starts a dedicated Web Worker and
  routes SQL operations through it. OPFS sync access handle APIs are used in
  that worker context.
- Single-tab mode does not require `BroadcastChannel` or Web Locks for
  election, but committed transactions still go through the collection's
  registered persistence owner.
- Multi-tab mode requires `BroadcastChannel` and the Web Locks API; both are
  available in all modern browsers.
- OPFS capability failures are surfaced as `PersistenceUnavailableError`.
