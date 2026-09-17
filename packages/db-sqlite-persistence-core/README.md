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
- `ReleaseRemoteSubsetRequest`
- `ReleaseRemoteSubsetResponse`
- `RemoteSubsetOwner`
- `DuplicateRemoteSubsetOwnerError`
- `TransportedLoadSubsetOptions`
- `RemoteSubsetWirePrimitive`
- `RemoteSubsetWireTypedArray`
- `RemoteSubsetWireRecord`
- `RemoteSubsetWireValue`
- `RemoteSubsetWireExpression`
- `RemoteSubsetWireCompareOptions`
- `RemoteSubsetWireOrderByClause`
- `RemoteSubsetWireCursor`
- `RemoteSubsetWireValueError`
- `toTransportedLoadSubsetOptions(...)`
- `ApplyLocalMutationsRequest`
- `ApplyLocalMutationsResponse`
- `ApplyCommittedTxRequest`
- `ApplyCommittedTxResponse`
- `PullSinceRequest`
- `PullSinceResponse`
- `CollectionReset`
- `PersistedIndexSpec`
- `PersistedRowMetadataMutation<TKey>`
- `PersistedCollectionMetadataMutation`
- `ReplayableTxDelta<T, TKey>`
- `PersistedScannedRow<T, TKey>`
- `PersistedRowScanOptions`
- `PersistedTx<T, TKey>`
- `PersistenceAdapter`
- `SQLiteDriver`
- `PersistedCollectionCoordinator`
- `PersistedCollectionPersistence`
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

### Coordinator contract

Every `PersistedCollectionCoordinator` must implement
`requestApplyCommittedTx(collectionId, tx)`. A sync transaction with durable
effects is routed in full to the persistence adapter owned by that collection.
The `PersistedTx` includes any truncate, row mutations, row metadata mutations,
collection metadata mutations, and stream position. Multiprocess coordinators
must preserve the complete transaction when they forward it to the elected
writer. This contract does not decide whether an effect-free source commit
should produce a persistence call.

This is a required invariant, not a capability to detect at commit time. The
TypeScript interface requires the method, and `persistedCollectionOptions(...)`
validates custom coordinators when it configures a collection. An untyped
integration that omits the method throws
`InvalidPersistedCollectionCoordinatorError` before the sync source starts or
publishes rows. Implementations must not fall back to a row-only route such as
`requestApplyLocalMutations(...)`, because that would discard transaction
semantics.

After a mutating RPC transport failure, replay is allowed only while the
requester can prove the same non-null leader id and term still own the route.
If either value was unknown for the first attempt, or either value changes,
the request rejects with `IndeterminateCommitError` and requires application
reconciliation. Coordinators never retry an indeterminate mutation against an
unknown or replacement leader.

`SingleProcessCoordinator` also implements the complete route. It is always
leader and has no cross-process transport, but it applies the transaction to
the resolved adapter registered for the specific collection. The Browser and
Electron coordinators provide the corresponding elected-owner route in their
runtime packages.

An adapter/storage rejection is surfaced as
`PersistedCollectionDurabilityError`, never as `CONFLICT`. The error preserves
the original local cause and its `code` and `path` fields. A transported
`PERSISTENCE_ERROR` response carries the source code/path that can cross the
coordinator boundary. Source writes remain published before their applied
receipt settles; if persistence then fails, the receipt rejects with the named
error and the collection enters its existing `error` lifecycle state. The
collection does not continue, retry, or fall back to a partial writer.

### Remote subset wire contract

`requestEnsureRemoteSubset(collectionId, options)` accepts the full live
`LoadSubsetOptions` input. Before choosing a local owner or remote transport,
every built-in coordinator projects it once to the exported
`TransportedLoadSubsetOptions` contract. A registered remote-subset owner
receives that transported type, never live-only fields such as `signal` or
`subscription`.

Expression values may contain structured-clone-safe primitives, plain records,
arrays (including sparse arrays), `Date`, zero-position `RegExp`, fixed
`ArrayBuffer`, fixed `DataView`, the views listed by the exported
`RemoteSubsetWireTypedArray` union (`Int8Array`, `Uint8Array`,
`Uint8ClampedArray`, `Int16Array`, `Uint16Array`, `Int32Array`, `Uint32Array`,
`Float32Array`, `Float64Array`, `BigInt64Array`, and `BigUint64Array`), `Map`,
and `Set`. Cycles and aliases are preserved. Other view types; shared,
resizable, growable, or detached buffers; accessors; non-enumerable or symbol
keys; native expandos; custom prototypes; promises; weak collections;
functions; and symbols are outside the contract. A rejected value throws the exported
`RemoteSubsetWireValueError` before owner work or transport, with its exact
path in the request. The wire contract does not provide codecs, coercion, or
lossy normalization for unsupported values.

Remote subset ownership is lease-based. A coordinator gives each accepted
request object a stable acquisition identity scoped to its collection and
requester. Retrying the same acquisition coalesces with the original; a second
request object with equal values is an independent lease. Releasing a lease
calls the registered owner's required `unloadSubset(...)` method with the exact
transported options object that was loaded. Releasing it again is a no-op.
`EnsureRemoteSubsetRequest.acquisitionId` is the wire identity established by
acquisition; `ReleaseRemoteSubsetRequest.acquisitionId` must carry that same
identity so the elected owner releases the matching lease.

The owner also provides a required `onError(error)` callback. A load or unload
throw, or a runtime thenable rejection from either operation, is reported
through that callback with the original value before the awaited request
rejects. Retirement and disposal observe and report the same failure while
continuing cleanup of sibling leases; they do not retry or silently recover
the failed lifecycle.

Only one remote subset owner may be registered per collection in a coordinator.
A second live registration throws `DuplicateRemoteSubsetOwnerError` instead of
replacing the first. When a leader loses ownership or is disposed, it unloads
every transferred lease. A requester that still owns a lease replays that same
acquisition when the next leader is observed. There is no adapter fallback or
direct-writer escape hatch for missing ownership.

The named-error and exact-path guarantee covers values the boundary can
identify with standard JavaScript reflection. A fully transparent `Proxy` is
outside the public wire type and cannot be portably distinguished from its
target. Untyped callers must not rely on Proxy identity, traps, or a
Proxy-specific diagnostic; no non-standard detection is attempted.

### SQLite core adapter APIs

- `SQLiteCoreAdapterOptions`
- `SQLitePullSinceResult<TKey>`
- `SQLiteCorePersistenceAdapter`
- `DEFAULT_APPLIED_TX_PRUNE_MAX_ROWS`
- `DEFAULT_APPLIED_TX_PRUNE_MAX_AGE_SECONDS`
- `createSQLiteCorePersistenceAdapter(...)`

### Error APIs

- `PersistedCollectionCoreError`
- `InvalidPersistedCollectionConfigError`
- `InvalidSyncConfigError`
- `InvalidPersistedCollectionCoordinatorError`
- `InvalidPersistenceAdapterError`
- `PersistedCollectionDurabilityErrorOptions`
- `PersistedCollectionDurabilityError`
- `toPersistedCollectionDurabilityError(...)`
- `IndeterminateCommitRequestType`
- `IndeterminateCommitErrorOptions`
- `IndeterminateCommitError`
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
