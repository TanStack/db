# @tanstack/db-sqlite-persisted-collection-core

Shared SQLite persistence primitives for TanStack DB. Runtime-specific wrappers
(Node, Electron, React Native/Expo, Cloudflare Durable Objects) build on top of
this package.

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
- `PersistedTx<T, TKey>`
- `PersistenceAdapter<T, TKey>`
- `SQLiteDriver`
- `PersistedCollectionCoordinator`
- `PersistedCollectionPersistence<T, TKey>`
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

## Typical usage (via runtime wrappers)

In most applications, use a runtime package directly:

- `@tanstack/db-node-sqlite-persisted-collection`
- `@tanstack/db-electron-sqlite-persisted-collection`
- `@tanstack/db-react-native-sqlite-persisted-collection`
- `@tanstack/db-cloudflare-do-sqlite-persisted-collection`

Those packages provide concrete drivers and re-export these core APIs for
ergonomic usage.
