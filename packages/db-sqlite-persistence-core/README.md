# @tanstack/db-sqlite-persistence-core

Shared SQLite persistence primitives for TanStack DB. Runtime-specific wrappers
(Node, Electron, React Native, Cloudflare Durable Objects) build on top of this
package.

## What this package provides

- Generic persisted collection wrapper utilities
- Shared persistence/coordinator protocol types
- SQLite core persistence adapter (`createSQLiteCorePersistenceAdapter`)
- Validation and storage key helpers
- Shared error types

This package intentionally does **not** include a concrete SQLite engine
binding. Provide a runtime `SQLiteDriver` implementation from a wrapper package.

## Exported API (complete)

### Persisted wrapper and protocol APIs

- `PersistedMutationEnvelope`
- `ProtocolEnvelope<TPayload>`
- `LeaderHeartbeat`
- `TxCommitted`
- `EnsureRemoteSubsetRequest`
- `EnsureRemoteSubsetResponse`
- `ApplyLocalMutationsRequest`
- `ApplyLocalMutationsResponse`
- `PullSinceRequest`
- `PullSinceResponse`
- `CollectionReset`
- `PersistedIndexSpec`
- `PersistedKeySetEvidence`
- `PersistedTx<T, TKey>`
- `PersistenceAdapter<T, TKey>`
- `SQLiteDriver`
- `PersistedCollectionCoordinator`
- `PersistedCollectionPersistence<T, TKey>`
- `PersistedCollectionMode`
- `PersistedCollectionLeadershipState`
- `PersistedCollectionUtils`
- `PersistedSyncWrappedOptions<T, TKey, TSchema, TUtils>`
- `PersistedLocalOnlyOptions<T, TKey, TSchema, TUtils>`
- `SingleProcessCoordinator`
- `validatePersistedCollectionCoordinator(...)`
- `persistedCollectionOptions(...)`
- `encodePersistedStorageKey(...)`
- `decodePersistedStorageKey(...)`
- `createPersistedTableName(...)`

`PersistedCollectionPersistence` can optionally implement:

- `resolvePersistenceForMode(mode)` (legacy mode-aware resolution)
- `resolvePersistenceForCollection({ collectionId, mode, schemaVersion })`
  (collection-aware resolution)

`persistedCollectionOptions(...)` now supports `schemaVersion` per collection
and resolves persistence using:

- collection id
- inferred mode (`sync-present` or `sync-absent`)
- optional `schemaVersion`

This lets runtime wrappers expose one shared persistence instance per database
while still handling per-collection schema versions correctly.

### Atomic resume snapshots

Persistence adapters may implement
`loadResumeSnapshot(collectionId, options)` to let a sync source certify a
persisted resume baseline. One call must read rows, collection metadata, stream
position, reset epoch, and key-set evidence from the same atomic database
snapshot. `includeRows: false` requests the same certification data without
materializing rows; `requiredIndexSignatures` carries the indexes needed by a
row-bearing snapshot.

`PersistedKeySetEvidence.status` has three states:

- `consistent`: the persisted rows match the adapter's durable expected-key
  ledger.
- `incompatible`: row loss, substitution, or a reset-generation change makes
  the saved resume baseline unsafe.
- `unknown`: the adapter has no authoritative pre-migration key set and does
  not claim completeness.

The method is optional so existing adapters remain assignable. Without it, the
wrapper retains the legacy stream-position and metadata path. Adapter methods
are invoked with their receiver and may rely on instance state through `this`.

### SQLite core adapter APIs

- `SQLiteCoreAdapterOptions`
- `SQLitePullSinceResult<TKey>`
- `SQLiteCorePersistenceAdapter<T, TKey>`
- `createSQLiteCorePersistenceAdapter<T, TKey>(...)`

### Error APIs

- `PersistedCollectionCoreError`
- `InvalidPersistedCollectionConfigError`
- `InvalidSyncConfigError`
- `InvalidPersistedCollectionCoordinatorError`
- `InvalidPersistenceAdapterError`
- `InvalidPersistedStorageKeyError`
- `InvalidPersistedStorageKeyEncodingError`
- `PersistenceUnavailableError`

## Typical usage (via runtime wrappers)

In most applications, use a runtime package directly:

- `@tanstack/node-db-sqlite-persistence`
- `@tanstack/browser-db-sqlite-persistence`
- `@tanstack/electron-db-sqlite-persistence`
- `@tanstack/react-native-db-sqlite-persistence`
- `@tanstack/cloudflare-durable-objects-db-sqlite-persistence`

Those packages provide concrete drivers and runtime wiring.
