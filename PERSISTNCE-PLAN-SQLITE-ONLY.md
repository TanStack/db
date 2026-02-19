# Persisted Collections + Multi-Tab Query-Driven Sync (SQLite-Only)

## Summary

This plan standardizes persistence on SQLite across runtimes and removes raw IndexedDB as a first-class persistence adapter.

In the browser, persistence is OPFS-only via `wa-sqlite` + `OPFSCoopSyncVFS`, with no SharedWorker requirement. Multi-tab coordination uses Web Locks, Visibility API, and BroadcastChannel.

Leadership is **per collection** (per table), not global per database.

`persistedCollectionOptions(...)` infers behavior from the wrapped options:

1. if wrapped options include `sync`, persistence augments that sync path
2. if wrapped options do not include `sync`, persistence runs sync-absent with SQLite as source of truth

## Background

TanStack DB on-demand sync uses `loadSubset(options)` as the choke point for query-driven loading and pagination. Persistence should plug into this same mechanism so:

- any tab can load from local persistence immediately
- leader tabs handle remote coverage checks when sync is enabled
- tabs receive ordered updates and remain coherent
- persisted indexes mirror collection index creation in user space

## Locked Decisions

1. SQLite-only persistence architecture.
2. Browser storage is OPFS-only (`wa-sqlite` + `OPFSCoopSyncVFS`).
3. No SharedWorker requirement in the browser architecture.
4. Leadership is collection-scoped: single writer per collection/table.
5. `persistedCollectionOptions(...)` infers sync-present vs sync-absent behavior from presence of `sync`.
6. Cloudflare Durable Objects SQLite is a supported runtime target.
7. Delete tracking uses per-key tombstone state (one row per deleted key) with monotonic `row_version`.

## Goals

1. Local-first `loadSubset` in every runtime.
2. Correct multi-tab behavior with collection-scoped leadership.
3. Fast local reads from SQLite in every tab.
4. Reliable replay ordering via `(term, seq)`.
5. Persisted index parity with TanStack DB index lifecycle.
6. Sync-absent persisted collections with automatic mutation persistence.
7. Runtime coverage for browser, node, RN, Expo, Electron, and Cloudflare Durable Objects.

## Non-Goals

1. Raw IndexedDB persistence adapter.
2. SharedWorker-based mandatory architecture.
3. Full SQL pushdown for arbitrary unsupported expressions in v1.
4. Global single-writer guarantee for all tables in one DB file.
5. Perfect index GC/eviction policy in v1.

## Runtime Scope

| Runtime                    | Engine                           | Notes                                             |
| -------------------------- | -------------------------------- | ------------------------------------------------- |
| Browser                    | `wa-sqlite`                      | OPFS + `OPFSCoopSyncVFS`, leader per collection   |
| Node                       | `better-sqlite3`                 | Reference runtime + CI contract tests             |
| React Native               | `op-sqlite`                      | Thin driver over shared core                      |
| Expo                       | `op-sqlite`                      | Thin driver over shared core                      |
| Electron                   | `better-sqlite3` in main process | Renderer via IPC                                  |
| Cloudflare Durable Objects | SQLite-backed DO storage         | DB executes in-process inside DO; no tab election |

## High-Level Design

### 1) `persistedCollectionOptions(...)` Infers Behavior from Wrapped Options

#### A) `sync` Present in Wrapped Options

Wrap an existing sync collection and add local SQLite persistence.

```ts
const tasks = createCollection(
  persistedCollectionOptions({
    ...queryCollectionOptions({
      /* existing remote sync */
    }),
    persistence: {
      adapter: BrowserWASQLiteStorage({ dbName: 'app' }),
      coordinator: BrowserCollectionCoordinator({ dbName: 'app' }),
    },
  }),
)
```

#### B) No `sync` in Wrapped Options

No wrapped remote sync is required. SQLite persistence is source of truth.

```ts
const drafts = createCollection(
  persistedCollectionOptions({
    id: 'drafts',
    getKey: (row) => row.id,
    persistence: {
      adapter: BrowserWASQLiteStorage({ dbName: 'app' }),
      coordinator: BrowserCollectionCoordinator({ dbName: 'app' }),
    },
  }),
)
```

When `sync` is absent, mutations are automatically persisted (like `localStorageCollectionOptions`) and do not require remote sync.

### 1.1) TypeScript API Sketch (Inferred Overloads)

The API should use overloads so mode is inferred at compile-time from whether `sync` exists on wrapped options.

```ts
type PersistedCollectionPersistence<
  T extends object,
  TKey extends string | number,
> = {
  adapter: PersistenceAdapter<T, TKey>
  coordinator?: PersistedCollectionCoordinator
}

type PersistedSyncWrappedOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
> = CollectionConfig<T, TKey, TSchema, TUtils> & {
  sync: SyncConfig<T>
  persistence: PersistedCollectionPersistence<T, TKey>
}

type PersistedLocalOnlyOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
> = Omit<CollectionConfig<T, TKey, TSchema, TUtils>, 'sync'> & {
  persistence: PersistedCollectionPersistence<T, TKey>
}

export function persistedCollectionOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
>(
  options: PersistedSyncWrappedOptions<T, TKey, TSchema, TUtils>,
): CollectionConfig<T, TKey, TSchema, TUtils>

export function persistedCollectionOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
>(
  options: PersistedLocalOnlyOptions<T, TKey, TSchema, TUtils>,
): CollectionConfig<T, TKey, TSchema, TUtils & PersistedCollectionUtils>
```

Runtime rule:

- `if (options.sync != null)` => sync-present path
- else => sync-absent path
- if `persistence.coordinator` is omitted, use `SingleProcessCoordinator` (intended for DO/node single-process execution)

Inference edge-case rules (fixed):

- sync-present requires `options.sync` with callable `sync` function.
- `sync` key present but invalid (`null`, non-object, missing `sync` function) throws `InvalidSyncConfigError`.
- sync-absent path is selected only when `sync` key is not present.
- user-provided `onInsert/onUpdate/onDelete` remain supported in both paths; sync-absent wrappers compose and then persist.

`PersistedCollectionUtils` should include:

- `acceptMutations(transaction)` for manual transactions
- optional debug helpers (`getLeadershipState`, `forceReloadSubset`) for tests/devtools

### 2) Index Lifecycle Mirrors Main-Thread Indexing

Persisted indexes are created from the same collection index lifecycle as user-space query indexes:

- manual `collection.createIndex(...)`
- auto indexing (`autoIndex`)

Required events in `@tanstack/db`:

- `index:added`
- `index:removed`

Persistence listens and ensures/removes matching persisted indexes.

### 3) Storage Backend Options (All SQLite)

Every backend uses the same logical persistence model (table-per-collection + JSON payloads + expression indexes), but runtime wiring differs.

#### Browser: `wa-sqlite` + `OPFSCoopSyncVFS`

- storage: OPFS-only
- coordinator: `BrowserCollectionCoordinator` (Web Locks + Visibility + BroadcastChannel)
- leadership: collection-scoped in-tab election

Browser capability baseline:

- Phase 7 (single-tab) requires OPFS with `FileSystemSyncAccessHandle`.
- Phase 8 (multi-tab coordinator) additionally requires Web Locks.
- Target support is evergreen browsers from roughly the last 3 years that satisfy those capabilities.

##### Browser Coordination (No SharedWorker)

Election and preference:

- Web Locks key per collection:
  - `tsdb:leader:<dbName>:<collectionId>`
- Web Locks key for SQLite write serialization:
  - `tsdb:writer:<dbName>`
- Visibility API is a preference hint:
  - visible tabs should be preferred leaders
  - hidden leaders can step down cooperatively

Visibility handoff protocol:

- a leader entering hidden state starts `HIDDEN_STEPDOWN_DELAY_MS` (default 5000ms)
- while hidden, it listens for `leader:candidate` announcements from visible tabs
- if a visible contender is observed and delay elapses, current leader releases collection lock
- after handoff, apply `LEADER_HANDOFF_COOLDOWN_MS` (default 3000ms) before trying to re-acquire to prevent thrash

Messaging:

- BroadcastChannel namespace per collection:
  - `tx` messages with `(term, seq)` and commit metadata
  - `rpc` messages for `ensureRemoteSubset`, `ensurePersistedIndex`, `applyLocalMutations`
  - `leader` heartbeat/announcement

Ordering and recovery:

- each collection stream has ordered `(term, seq)`
- followers track latest `(term, seq)` seen
- followers:
  - ignore old terms
  - ignore duplicate seq
  - trigger catch-up on seq gap via `rpc:pullSince`
  - if catch-up fails, fallback to stale-mark + subset reload

Leadership lifecycle algorithm:

1. Tab starts collection interest:

- subscribe to collection channel
- attempt Web Lock acquisition for `tsdb:leader:<dbName>:<collectionId>`

2. If lock acquired:

- increment and persist `term` in SQLite metadata (transactional)
- become leader for that collection
- start heartbeat timer

3. If tab becomes hidden and another visible contender exists:

- leader may step down cooperatively and release lock

4. On lock loss or unload:

- stop sync tasks for that collection
- stop heartbeat
- continue follower read path

5. Followers watch heartbeat timeout:

- on timeout, attempt lock acquisition and leadership takeover

`term` monotonicity requirement:

- `term` must survive reload/restart and never decrement for a collection.
- leaders read+increment `leader_term` inside a SQLite transaction before emitting heartbeat.

#### Node

- storage: local sqlite via `better-sqlite3`
- coordinator: `SingleProcessCoordinator` by default
- common use: tests, server-side execution, tooling

#### React Native / Expo

- storage: `op-sqlite` wrappers for RN and Expo
- coordinator: typically `SingleProcessCoordinator` (single process), can be overridden if host adds cross-process sync
- packaging: one shared mobile package with RN/Expo-specific entrypoints only where needed

#### Electron

- storage: sqlite in main process
- coordinator: `SingleProcessCoordinator` in main process
- renderer interaction: via IPC bridge only
- packaging: separate electron package that wraps node adapter semantics with IPC transport

#### Cloudflare Durable Objects (In-Process)

Cloudflare Durable Objects run as single-threaded stateful actors with attached SQLite-backed storage. For a DO instance:

- no browser-style leader election is needed
- the DO instance is authoritative writer for its storage
- `loadSubset` and mutation persistence execute directly in-object
- optional upstream sync can still be layered if needed, but sync-absent local persistence is a natural default
- this is an in-runtime execution model (DB + persistence in the same DO process), not a remote persistence adapter pattern

Example shape inside a DO:

```ts
export class AppDurableObject extends DurableObject {
  private tasks = createCollection(
    persistedCollectionOptions({
      id: 'tasks',
      getKey: (row) => row.id,
      persistence: {
        adapter: durableObjectSQLiteAdapter(this.ctx.storage.sql),
        // coordinator omitted -> SingleProcessCoordinator
      },
    }),
  )
}
```

### 4) Collection-Scoped Coordinator

Coordinator responsibilities per collection:

- election: one leader per `collectionId`
- ordered broadcast of committed tx (`term`, `seq`)
- RPC:
  - `ensureRemoteSubset(collectionId, options)` when `sync` is present
  - `ensurePersistedIndex(collectionId, signature, spec)`
  - `applyLocalMutations(collectionId, mutations)` when `sync` is absent and follower is not leader

Tabs do not proxy reads through leaders; each tab reads SQLite directly.

Runtime note:

- browser uses `BrowserCollectionCoordinator` (election + BroadcastChannel RPC)
- DO/node single-process execution uses `SingleProcessCoordinator` (no election, no cross-tab RPC)

Coordinator contract (minimum surface):

```ts
interface PersistedCollectionCoordinator {
  getNodeId(): string
  subscribe(
    collectionId: string,
    onMessage: (message: ProtocolEnvelope<unknown>) => void,
  ): () => void
  publish(collectionId: string, message: ProtocolEnvelope<unknown>): void
  isLeader(collectionId: string): boolean
  ensureLeadership(collectionId: string): Promise<void>
  requestEnsureRemoteSubset?(
    collectionId: string,
    options: LoadSubsetOptions,
  ): Promise<void>
  requestEnsurePersistedIndex(
    collectionId: string,
    signature: string,
    spec: PersistedIndexSpec,
  ): Promise<void>
  requestApplyLocalMutations?(
    collectionId: string,
    mutations: Array<PersistedMutationEnvelope>,
  ): Promise<ApplyLocalMutationsResponse>
  pullSince?(
    collectionId: string,
    fromRowVersion: number,
  ): Promise<PullSinceResponse>
}
```

Coordinator validation rule:

- wrapper validates required coordinator methods at initialization based on runtime mode.
- browser multi-tab mode requires `requestEnsureRemoteSubset`, `requestApplyLocalMutations`, and `pullSince`.
- single-process coordinators (node/electron/do and browser single-tab) may omit cross-tab RPC helpers.

### 4.1) Coordinator Protocol (Implementation Draft)

Message envelope:

```ts
type ProtocolEnvelope<TPayload> = {
  v: 1
  dbName: string
  collectionId: string
  senderId: string
  ts: number
  payload: TPayload
}
```

Message payloads:

```ts
type LeaderHeartbeat = {
  type: 'leader:heartbeat'
  term: number
  leaderId: string
  latestSeq: number
  latestRowVersion: number
}

type TxCommitted = {
  type: 'tx:committed'
  term: number
  seq: number
  txId: string
  latestRowVersion: number
} & (
  | {
      requiresFullReload: true
    }
  | {
      requiresFullReload: false
      changedKeys: Array<string | number>
      deletedKeys: Array<string | number>
    }
)

type EnsureRemoteSubsetRequest = {
  type: 'rpc:ensureRemoteSubset:req'
  rpcId: string
  options: LoadSubsetOptions
}

type EnsureRemoteSubsetResponse =
  | {
      type: 'rpc:ensureRemoteSubset:res'
      rpcId: string
      ok: true
    }
  | {
      type: 'rpc:ensureRemoteSubset:res'
      rpcId: string
      ok: false
      error: string
    }

type ApplyLocalMutationsRequest = {
  type: 'rpc:applyLocalMutations:req'
  rpcId: string
  envelopeId: string
  mutations: Array<PersistedMutationEnvelope>
}

type ApplyLocalMutationsResponse =
  | {
      type: 'rpc:applyLocalMutations:res'
      rpcId: string
      ok: true
      term: number
      seq: number
      latestRowVersion: number
      acceptedMutationIds: Array<string>
    }
  | {
      type: 'rpc:applyLocalMutations:res'
      rpcId: string
      ok: false
      code: 'NOT_LEADER' | 'VALIDATION_ERROR' | 'CONFLICT' | 'TIMEOUT'
      error: string
    }

type PullSinceRequest = {
  type: 'rpc:pullSince:req'
  rpcId: string
  fromRowVersion: number
}

type PullSinceResponse =
  | {
      type: 'rpc:pullSince:res'
      rpcId: string
      ok: true
      latestTerm: number
      latestSeq: number
      latestRowVersion: number
      requiresFullReload: true
    }
  | {
      type: 'rpc:pullSince:res'
      rpcId: string
      ok: true
      latestTerm: number
      latestSeq: number
      latestRowVersion: number
      requiresFullReload: false
      changedKeys: Array<string | number>
      deletedKeys: Array<string | number>
    }
  | {
      type: 'rpc:pullSince:res'
      rpcId: string
      ok: false
      error: string
    }

type CollectionReset = {
  type: 'collection:reset'
  schemaVersion: number
  resetEpoch: number
}
```

Idempotency rules:

- `tx:committed` idempotency key: `(collectionId, term, seq)`
- local mutation idempotency key: `envelopeId`
- mutation acknowledgment/correlation key: `mutationId` (per mutation inside an envelope)
- RPC response correlation key: `rpcId`
- `applyLocalMutations` is at-least-once delivery; leader must dedupe by `envelopeId`
- catch-up cursor key: `latestRowVersion` (monotonic per collection)
- followers persist `lastSeenRowVersion` from applied `tx:committed` messages and successful `pullSince` responses

Recommended browser defaults:

- heartbeat interval: 2000ms
- leader timeout: 6000ms
- RPC timeout: 5000ms
- local mutation retry backoff: 100ms → 2000ms capped exponential
- all timing knobs should be configurable per collection (advanced option)

## Key Mechanics

### A) Writer Ownership

- logical single writer per collection/table at a time
- different tabs can lead different collections simultaneously
- followers do not write that collection directly in browser mode
- follower writes are routed to current leader for serialization

SQLite write-lock note:

- SQLite still permits one write transaction at a time per database file.
- collection leaders therefore coordinate through `tsdb:writer:<dbName>` before write transactions.
- this keeps per-collection leadership for ownership, while serializing physical DB writes to avoid `SQLITE_BUSY` thrash.

### A.1) Commit + Broadcast Ordering

Leader commit pipeline for a collection change:

1. acquire DB writer lock (`tsdb:writer:<dbName>`)
2. begin SQLite transaction
3. increment collection `latest_row_version` and stamp touched rows with that version
4. apply row and index changes
5. for deletes, insert/update tombstone records with same `row_version`
6. insert idempotency marker in `applied_tx(collection_id, term, seq, applied_at)`
7. read updated `latest_row_version` for broadcast
8. commit SQLite transaction
9. release DB writer lock
10. broadcast `tx:committed(term, seq, latestRowVersion, ...)`

Delete tracking note:

- tombstones are the delete source for `pullSince` key-level catch-up.
- tombstones are stateful per key (latest delete only), not append-only history.

Recovery rule:

- if commit succeeds but broadcast is missed, followers detect stale `latestSeq` via heartbeat and call `pullSince`.

### A.2) Subset Invalidation Contract

Followers maintain an in-memory registry of active loaded subsets per collection.

Default:

- `TARGETED_INVALIDATION_KEY_LIMIT = 128`

On `tx:committed`:

1. if `requiresFullReload` is true:

- mark all active subsets for that collection dirty
- schedule debounced reload from local SQLite

2. else if `changedKeys`/`deletedKeys` present and combined count <= `TARGETED_INVALIDATION_KEY_LIMIT`:

- refresh only subsets that may contain those keys

3. else:

- mark all active subsets for that collection dirty
- schedule debounced reload from local SQLite

This removes ambiguity around follower refresh behavior while keeping correctness first.

### B) `loadSubset` Flow by Inferred Behavior

#### When `sync` Is Present

1. query local SQLite immediately
2. apply local rows
3. request leader `ensureRemoteSubset(...)` (online path)
4. leader syncs/writes/broadcasts commits
5. tabs refresh from SQLite on broadcast

#### When `sync` Is Absent

1. query local SQLite immediately
2. apply local rows
3. no remote ensure call
4. tab refresh remains local/broadcast-driven only

### C) Hydrate Barrier (Both Modes)

Problem: updates can arrive during local hydrate.

Wrapper state per collection:

- `isHydrating: boolean`
- `queuedTx: PersistedTx[]`
- `applyMutex` serializing write/apply

Scope:

- hydrate barrier is collection-scoped (not per-subset) because transactions can affect any active subset in that collection.

Algorithm:

1. `loadSubset` sets `isHydrating = true`
2. query cached rows from SQLite
3. apply local rows via `write({ type: 'update', ... })`
4. set `isHydrating = false`
5. flush queued tx in order

### D) Duplicate-Key Safety (Sync-Present Path)

To avoid `DuplicateKeySyncError` when cache overlaps remote snapshot:

- local hydrate uses `update` only (never `insert`)
- remote `insert` payloads are normalized to `update` before DB `write`

### E) Sync-Absent Mutation Persistence

When `sync` is absent, mutation changes persist automatically, aligned with `localStorageCollectionOptions` behavior.

`PersistedMutationEnvelope` shape:

```ts
type PersistedMutationEnvelope =
  | {
      mutationId: string
      type: 'insert'
      key: string | number
      value: Record<string, unknown>
    }
  | {
      mutationId: string
      type: 'update'
      key: string | number
      value: Record<string, unknown>
    }
  | {
      mutationId: string
      type: 'delete'
      key: string | number
      value: Record<string, unknown>
    }
```

- wrap `onInsert`, `onUpdate`, `onDelete` to persist SQLite changes automatically
- confirm optimistic operations through sync-confirm path after persistence
- for manual transactions, expose and use `utils.acceptMutations(transaction)`
- in browser multi-tab, non-leader tabs send local mutations to leader via `applyLocalMutations`
- leader must reply with `applyLocalMutations:res` so follower can confirm or rollback optimistic entries

### F) Offline/Online Behavior

- when `sync` is present:
  - offline `loadSubset` resolves locally
  - queued `ensureRemoteSubset` replays when online
- when `sync` is absent:
  - unaffected by network state

### G) Seq Gap Recovery

On missing `(term, seq)`:

1. use follower-tracked `lastSeenRowVersion` (from last applied commit or pull response) and request `pullSince(lastSeenRowVersion)` from current leader
2. if pull succeeds and `requiresFullReload` is true, mark collection subsets dirty
3. if pull succeeds with `changedKeys`/`deletedKeys`, run targeted subset invalidation
4. reload affected subsets from local SQLite (or all active subsets when required)
5. if pull fails, mark view stale and truncate/reload affected in-memory view
6. re-request loaded subsets
7. re-run remote ensure only when `sync` is present

`pullSince` implementation rule:

- `changedKeys` are derived from `c_<tableName>` rows where `row_version > fromRowVersion`
- `deletedKeys` are derived from tombstones `t_<tableName>` where `row_version > fromRowVersion`
- this computes a delta to latest state (not a full linear event history)
- if either result set exceeds invalidation limits, set `requiresFullReload: true`

## SQLite Storage + Index Plan

### Schema (Per Collection)

Single table per collection:

- `key` stored as canonical encoded text key (`s:<value>` or `n:<value>`) to preserve `1` vs `'1'` distinction
- `key` TEXT PRIMARY KEY
- `value` JSON string in `TEXT`
- `row_version` INTEGER NOT NULL (monotonic change version stamped by leader; per-transaction watermark shared by all rows touched in one committed tx)
- tombstone table per collection tracks latest delete state per key with row versions (`t_<tableName>`)
- tombstone `deleted_at` stores deletion timestamp for diagnostics/observability; catch-up logic uses `row_version`

Key encoding helpers (required):

```ts
function encodeStorageKey(key: string | number): string {
  if (typeof key === 'number') {
    if (!Number.isFinite(key)) {
      throw new Error('Invalid numeric key: key must be finite')
    }
    if (Object.is(key, -0)) {
      return 'n:-0'
    }
    return `n:${key}`
  }
  return `s:${key}`
}

function decodeStorageKey(encoded: string): string | number {
  if (encoded === 'n:-0') {
    return -0
  }
  return encoded.startsWith('n:') ? Number(encoded.slice(2)) : encoded.slice(2)
}
```

Metadata tables:

- `persisted_index_registry(collection_id, signature, sql, state, last_built_at, last_used_at)`
- `applied_tx(collection_id, term, seq, applied_at)`
- `collection_version(collection_id, latest_row_version)` for catch-up cursor
- `leader_term(collection_id, term, leader_id, updated_at)` for durable term monotonicity
- `schema_version(collection_id, version)` for clear-on-version-change behavior
- `collection_reset_epoch(collection_id, epoch)` for coordinated clear/reload signaling
- `collection_registry(collection_id, table_name)` for safe identifier mapping

Identifier safety requirement:

- never interpolate raw `collectionId` into SQL identifiers
- map `collectionId` to safe physical table names using hashed names (for example `c_<base32(hash(collectionId))>`)
- store mapping in `collection_registry`

Reference DDL:

```sql
CREATE TABLE IF NOT EXISTS c_<tableName> (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  row_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS t_<tableName> (
  key TEXT PRIMARY KEY NOT NULL,
  row_version INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_registry (
  collection_id TEXT PRIMARY KEY NOT NULL,
  table_name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS persisted_index_registry (
  collection_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  sql TEXT NOT NULL,
  state TEXT NOT NULL,
  last_built_at INTEGER,
  last_used_at INTEGER,
  PRIMARY KEY (collection_id, signature)
);

CREATE TABLE IF NOT EXISTS applied_tx (
  collection_id TEXT NOT NULL,
  term INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (collection_id, term, seq)
);

CREATE TABLE IF NOT EXISTS collection_version (
  collection_id TEXT PRIMARY KEY NOT NULL,
  latest_row_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS leader_term (
  collection_id TEXT PRIMARY KEY NOT NULL,
  term INTEGER NOT NULL,
  leader_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_version (
  collection_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_reset_epoch (
  collection_id TEXT PRIMARY KEY NOT NULL,
  epoch INTEGER NOT NULL
);
```

### Persisted Index Signatures

Main-thread `indexId` is not stable across tabs. Use stable signature:

- `signature = hash(stableStringify({ expression, compareOptions, direction, nulls, stringSort, locale, ... }))`

### Expression Indexes

Indexes are created on demand from mirrored index specs, for example:

- `CREATE INDEX IF NOT EXISTS idx_<tableHash>_<sigHash> ON c_<tableName>(json_extract(value,'$.path'))`
- compound indexes use multiple expressions
- date/datetime predicates can use expression indexes over canonical extracted values (for example `datetime(json_extract(value,'$.dueAt'))`)

`ensureIndex(...)` compiles index IR/spec to canonical SQL expression text for reliable planner usage.

Reference query templates:

```sql
-- Increment and read collection row version (inside txn)
INSERT INTO collection_version(collection_id, latest_row_version)
VALUES (?, 1)
ON CONFLICT(collection_id) DO UPDATE SET latest_row_version = latest_row_version + 1;

SELECT latest_row_version FROM collection_version WHERE collection_id = ?;

-- Upsert row
INSERT INTO c_<tableName>(key, value, row_version)
VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  row_version = excluded.row_version;

-- Clear tombstone on re-insert/update
DELETE FROM t_<tableName> WHERE key = ?;

-- Delete row
DELETE FROM c_<tableName> WHERE key = ?;

-- Upsert tombstone for delete tracking
INSERT INTO t_<tableName>(key, row_version, deleted_at)
VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET
  row_version = excluded.row_version,
  deleted_at = excluded.deleted_at;

-- Mark tx applied
INSERT OR IGNORE INTO applied_tx(collection_id, term, seq, applied_at)
VALUES (?, ?, ?, ?);
```

### Metadata Retention / Cleanup

To prevent unbounded metadata growth:

- `applied_tx`: keep sliding window per collection by seq/time.
- tombstones (`t_<tableName>`) are per-key latest-delete state and are not version-pruned.
- tombstones are removed when the key is re-inserted/updated (same transaction as row upsert).

Defaults:

- `APPLIED_TX_SEQ_RETENTION = 10000`
- `APPLIED_TX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000`

### Partial Updates and Index Maintenance

Updates may be partial (`rowUpdateMode: 'partial'` default).

Adapters must:

- read current row
- merge partial update before persist
- compute index old/new values from pre-merge and post-merge rows

If `rowUpdateMode: 'full'` is configured, adapters can skip read/merge and write replacement rows.

### Schema Version Policy (No Migrations)

This plan does not implement structural schema migrations.

Collection options include `persistence.schemaVersion: number`.

Behavior on version mismatch:

- sync-present path:
  - default action: coordinated clear persisted state for that collection (rows + indexes + metadata), then rehydrate from remote sync
- sync-absent path:
  - default action: throw `PersistenceSchemaVersionMismatchError`
  - optional opt-in: allow clear and restart with empty local state

Coordinated clear sequence (sync-present path):

1. acquire `tsdb:writer:<dbName>`

- note: this serializes writes across the DB file, so schema reset briefly blocks writes for all collections

2. begin SQLite transaction
3. clear collection rows/tombstones/index metadata
4. reset collection cursor in `collection_version` (delete row or set `latest_row_version = 0`)
5. update `schema_version`
6. increment `reset_epoch`
7. commit transaction
8. broadcast `collection:reset(schemaVersion, resetEpoch)`

Follower behavior on `collection:reset`:

- reset tracked `lastSeenRowVersion` for that collection to `0`
- drop in-memory rows for that collection
- clear active subset cache
- re-request loaded subsets

Guidance for sync-absent collections:

- prefer additive/backward-compatible schema changes with value-level fallbacks
- because values are JSON payloads, additive evolution is expected to be the common safe path

### `loadSubset` Query Planning

v1 pushdown support:

- `eq`, `in`, `gt/gte/lt/lte`, `like`
- logical composition with both `AND` and `OR` (push down when each branch is pushdown-safe; otherwise fallback)
- `IN` is required in v1 because query-engine incremental join loading depends on it
  - handle empty, single, and large `IN` lists correctly
  - chunk very large lists to respect SQLite parameter limits when needed
- date/datetime comparisons on JSON fields serialized as canonical ISO-8601 UTC strings
  - planner may use canonical string comparison where valid
  - planner may compile to SQLite date functions (`datetime`, `strftime`) when normalization is required
- index-aligned `orderBy`

Unsupported predicate fragments load a superset; query engine filters remainder.

## Adapter Interfaces

`PersistedTx` (used by `applyCommittedTx`) shape:

```ts
type PersistedTx<T extends object, TKey extends string | number> = {
  txId: string
  term: number
  seq: number
  rowVersion: number
  mutations: Array<
    | { type: 'insert'; key: TKey; value: T }
    | { type: 'update'; key: TKey; value: T }
    | { type: 'delete'; key: TKey; value: T }
  >
}
```

### Persistence Adapter

```ts
export interface PersistenceAdapter<
  T extends object,
  TKey extends string | number,
> {
  // Read path (all tabs / all runtimes)
  loadSubset(
    collectionId: string,
    options: LoadSubsetOptions,
    ctx?: { requiredIndexSignatures?: string[] },
  ): Promise<Array<{ key: TKey; value: T }>>

  // Write path (leader for this collection, or DO instance)
  applyCommittedTx(
    collectionId: string,
    tx: PersistedTx<T, TKey>,
  ): Promise<void>

  // Index management
  ensureIndex(
    collectionId: string,
    signature: string,
    spec: PersistedIndexSpec,
  ): Promise<void>

  // Optional: some adapters handle index cleanup lazily or via collection reset flows.
  markIndexRemoved?(collectionId: string, signature: string): Promise<void>
}
```

`PersistedIndexSpec` must be serializable and derived from index lifecycle events.

### SQLite Driver Interface

```ts
export interface SQLiteDriver {
  exec(sql: string): Promise<void>
  query<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>
  run(sql: string, params?: readonly unknown[]): Promise<void>
  transaction<T>(fn: () => Promise<T>): Promise<T>
}
```

Driver adaptation note:

- sync drivers (for example `better-sqlite3`) are adapted via thin `Promise.resolve(...)` wrappers.
- this keeps one core async adapter path across runtimes; sync overhead is accepted for API consistency in v1.

## Package Plan

1. `@tanstack/db-sqlite-persisted-collection-core`
2. `@tanstack/db-browser-wa-sqlite-persisted-collection`
3. `@tanstack/db-node-sqlite-persisted-collection`
4. `@tanstack/db-react-native-sqlite-persisted-collection` (RN + Expo)
5. `@tanstack/db-electron-sqlite-persisted-collection`
6. `@tanstack/db-cloudflare-do-sqlite-persisted-collection`

SQLite core package contents (combined):

- `persistedCollectionOptions(...)` with inferred behavior based on presence of `sync`
- stable signature/hash utilities
- coordinator protocol types
- sync-absent mutation persistence helpers (`acceptMutations` flow)
- shared `SQLiteCoreAdapter(driver)`
- SQL expression compiler for index/query pushdown
- index registry management
- in-memory adapter + in-memory coordinator for unit tests

Future packaging note:

- if a non-SQLite backend is introduced later, split backend-agnostic surface out of this package at that time.

Cloudflare DO package contents:

- adapter binding to DO SQLite-backed storage APIs (for code executing inside DO)
- DO-friendly wrapper that defaults to `SingleProcessCoordinator` and omits browser election paths
- optional helper for mapping `collectionId` to table naming and schema-version handling

Electron package contents:

- thin wrapper over node sqlite package semantics
- IPC transport between renderer calls and main-process persistence execution
- does not duplicate node adapter/core logic; reuses node package implementation behind the IPC boundary

## Implementation Phases

### Phase 0: API + Runtime Feasibility

1. Finalize `persistedCollectionOptions` inference API (`sync` present vs absent).
2. Confirm Cloudflare DO adapter surface and runtime constraints.
3. Finalize coordinator protocol (`rpc`, `tx`, `leader`, `(term, seq)`), with browser multi-tab parts phase-gated.
4. Finalize key encoding and identifier hashing rules.
5. Finalize package boundaries around SQLite-only core.
6. Define staged rollout gates (single-process first, browser multi-tab last).

Deliverable: finalized API, package plan, capability matrix, and protocol spec.

### Phase 1: Add Index Lifecycle Events to `@tanstack/db`

1. Extend collection events with:

- `index:added`
- `index:removed`

2. Update `CollectionIndexesManager` to emit stable index metadata.
3. Add index removal API (`removeIndex(...)`) and emit `index:removed`.

Deliverable: index lifecycle observable and stable across tabs.

### Phase 2: Core Persisted Wrapper (Inferred Behavior)

1. Implement `sync`-present wrapper over `sync.sync(params)`.
2. Implement sync-absent behavior without required wrapped sync.
3. Add hydrate barrier + queued tx behavior.
4. Normalize remote inserts to updates (when `sync` is present).
5. Implement automatic mutation persistence wrappers (when `sync` is absent).
6. Add `utils.acceptMutations(transaction)` support for manual transactions.
7. Wire coordinator RPC (`ensureRemoteSubset`, `ensurePersistedIndex`, `applyLocalMutations`).
8. Implement seq-gap recovery path.
9. Implement inference edge-case validation (`InvalidSyncConfigError`).

Deliverable: core wrapper passes in-memory tests for both inferred paths.

### Phase 3: SQLite Core Adapter

1. Implement `applyCommittedTx`, `ensureIndex`, `loadSubset` SQL pushdown (`eq`, `in`, range, `like`, `AND`, `OR`, date/datetime predicates).
2. Implement partial update merge semantics.
3. Implement `leader_term`, `schema_version`, and identifier registry tables.
4. Implement schema-version mismatch behavior (clear vs error by path).
5. Implement applied_tx pruning jobs.
6. Add adapter contract tests in node sqlite runtime.

Deliverable: SQLite adapter contract passing in node.

### Phase 4: Node + Electron

1. Implement node wrapper over `better-sqlite3`.
2. Implement electron main-process ownership + renderer IPC over `better-sqlite3`.
3. Run shared contract/integration suites.

Deliverable: node/electron parity with core semantics.

### Phase 5: React Native + Expo

1. Implement shared mobile package over `op-sqlite`.
2. Provide RN/Expo-specific entrypoints only where host bootstrapping differs.
3. Validate mobile lifecycle and transaction semantics on both RN and Expo.

Deliverable: unified RN/Expo mobile package passes contract tests.

### Phase 6: Cloudflare Durable Objects

1. Implement DO SQLite adapter package.
2. Provide helper for per-object schema initialization and schema-version checks.
3. Support both inferred wrapper paths inside DO runtime (`sync` present or absent), with in-process execution only.
4. Add integration tests using Workers/DO test harness.

Deliverable: DB and persistence running in-process in Durable Objects with SQLite-backed storage.

### Phase 7: Browser Single-Tab (`wa-sqlite`, No Election)

1. Implement OPFS driver (`OPFSCoopSyncVFS`).
2. Implement browser adapter path with `SingleProcessCoordinator` semantics for single-tab usage.
3. Validate offline-first read/write path without BroadcastChannel/Web Locks dependencies.
4. Add browser single-tab integration tests.

Deliverable: stable browser persistence for single-tab sessions.

### Phase 8: Browser Multi-Tab Coordinator (Final Phase)

1. Implement Web Locks + Visibility + BroadcastChannel coordinator.
2. Implement per-collection leader/follower behavior for both inferred paths.
3. Implement follower local mutation RPC to leader with ack/rollback semantics.
4. Implement DB write serialization lock (`tsdb:writer:<dbName>`) and busy retry policy.
5. Add Playwright multi-tab tests.

Deliverable: stable browser local-first multi-tab behavior when `sync` is present or absent.

## Testing Strategy

### Unit Tests (Core Wrapper)

1. Index lifecycle:

- `createIndex` emits `index:added` with stable signature
- `removeIndex` emits `index:removed`

2. Local hydrate safety:

- hydrate uses `update` only
- remote inserts normalized to update

3. Hydrate barrier:

- tx during hydrate is queued then flushed in order

4. Sync-present offline/online queue:

- offline local resolve
- queued remote ensures replay online

5. Sync-absent mutation persistence:

- insert/update/delete auto-persist
- manual transaction `acceptMutations` persists and confirms

6. Seq-gap recovery:

- missing seq triggers `pullSince`; fallback to stale/reload/re-ensure

7. Inference validation:

- invalid `sync` shape throws `InvalidSyncConfigError`

8. Key encoding:

- `1` and `'1'` persist distinctly and round-trip correctly

9. Local mutation acking:

- `applyLocalMutations:res.acceptedMutationIds` maps to submitted `mutationId`s

### Adapter Contract Tests

Run same suite against:

- in-memory adapter
- browser `wa-sqlite` adapter
- node sqlite adapter
- electron wrapper (`better-sqlite3`) and unified mobile wrapper (`op-sqlite`) where harness supports
- cloudflare durable object sqlite adapter

Covers:

- `ensureIndex` + `loadSubset` index-path usage
- pushdown parity for `AND`/`OR`, `IN` (including empty/single/large lists), `LIKE`, and date/datetime comparisons
- `applyCommittedTx` row/index correctness
- idempotency and replay handling on `(term, seq)`
- monotonic `row_version` behavior and `pullSince` cursor correctness
- `pullSince` discriminated response shape correctness (`requiresFullReload=true` returns no key lists)
- tombstone-based delete catch-up correctness
- per-key tombstone state semantics (latest delete only) correctness
- applied_tx pruning does not break row-version catch-up correctness
- schema reset clears `collection_version` cursor and follower resets tracked `lastSeenRowVersion` to `0`
- sync-absent auto-persist semantics
- schema-version mismatch behavior (clear vs error by path)
- identifier safety mapping (unsafe collectionId still produces safe physical table names)

### Browser Single-Tab Integration Tests (Phase 7)

1. OPFS-backed init and reopen behavior.
2. Local-first `loadSubset` and mutation persistence correctness.
3. Sync-present offline local path and reconnect replay without leader election.
4. No dependency on BroadcastChannel/Web Locks for correctness in single-tab mode.

### Browser Multi-Tab Integration Tests (Playwright, Phase 8)

1. Two tabs with different collection leaders:

- tab A leads collection X
- tab B leads collection Y

2. Local reads do not round-trip through leader.
3. Sync-absent follower mutation is serialized via leader and persisted.
4. Auto-index creates persisted index and speeds repeated lookups.
5. Leader handoff on visibility change / tab close.
6. Sync-present offline local-first and reconnect catch-up.
7. Cross-collection leaders contend for DB writes without correctness loss (`tsdb:writer` lock test).
8. Commit-broadcast gap recovers via heartbeat `latestSeq` + `pullSince`.

### Cloudflare Durable Objects Integration Tests

1. Schema init + schema-version mismatch behavior per DO instance.
2. `loadSubset` + index pushdown correctness.
3. Sync-absent mutation persistence correctness in DO runtime.
4. Restart/rehydration behavior with persisted SQLite state.
5. No browser coordinator path in DO (`SingleProcessCoordinator` only).

### Corruption Recovery Tests

1. Corrupted sqlite open path triggers integrity failure handling.
2. Sync-present path clears persistence and rehydrates from remote.
3. Sync-absent path raises `PersistenceCorruptionError` unless explicit reset is requested.

## Agent Guard Rails (Implementation + Testing)

These are mandatory rules for agents implementing this plan.

1. No implementation step is complete without tests in the same change set.

- bug fixes must include a regression test
- new behavior must include positive and negative-path coverage

2. Do not progress to the next phase until the current phase exit criteria and tests are green.

- phase completion requires local pass and CI pass for the phase test scope

3. Operator support must be proven on both paths:

- pushdown path (SQL execution)
- fallback path (superset load + in-memory filtering)
- applies to `IN`, `AND`, `OR`, `LIKE`, and date/datetime predicates

4. `IN` is a v1 hard requirement because incremental join loading depends on it.

- test `IN` with empty lists, single value lists, and large lists
- test parameter chunking behavior for large lists against SQLite parameter limits

5. Date/datetime support requires canonical serialization and deterministic tests.

- JSON date values must use canonical ISO-8601 UTC strings
- include timezone/offset boundary tests
- test both lexical comparison mode and SQLite date-function mode when normalization is required

6. Any change to ordering, leadership, mutation routing, or replay must include failure-path tests.

- dropped broadcast handling
- heartbeat timeout and takeover
- leader stepdown/lock loss
- retry/idempotency behavior for mutation RPC

7. Cross-runtime parity is required for shared behavior.

- if behavior is intended to be shared, contract tests must pass across supported adapters
- runtime-specific deviations must be documented and explicitly tested

8. Schema safety and recovery semantics are non-optional.

- sync-present mismatch path must prove clear + rehydrate behavior
- sync-absent mismatch path must prove explicit error behavior (unless opt-in reset path is enabled)

9. Never loosen correctness for optimization without equivalence coverage.

- any pushdown/performance optimization must include query-equivalence tests against fallback behavior

## Failure Modes and Handling

1. OPFS unavailable in browser:

- when `sync` is absent: throw `PersistenceUnavailableError` at initialization
- when `sync` is present: default to disabling persistence for session and run remote sync path only
- expose capability/error to application so users can decide whether to hard-fail UI

2. Invalid inferred sync config:

- if `sync` key exists but is not a valid `SyncConfig`, throw `InvalidSyncConfigError`

3. No current leader for a collection in browser:

- local `loadSubset` still reads SQLite
- queue/timeout remote ensure or local-mutation RPC until election completes

4. Leader crash or tab close:

- Web Lock releases
- follower acquires leadership and resumes responsibilities

5. Broadcast gap:

- follower triggers collection recovery
- attempt `pullSince` catch-up first
- fallback to reload local subset and re-ensure when `sync` is present

6. Durable Object instance restart:

- in-memory state is rebuilt from persistent SQLite storage
- schema-version checks and clear/error policy run on initialization path

7. Coordinated schema reset while tabs are active:

- leader broadcasts `collection:reset`
- followers drop in-memory cache for that collection and reload subsets

8. SQLite corruption / integrity failure:

- detect on open/init (initial query failure or optional integrity check path)
- sync-present: clear persisted state and rehydrate from remote
- sync-absent: throw `PersistenceCorruptionError` and require explicit user reset
- expose `resetPersistence({ collectionId })` utility for app-level recovery

## Risks and Mitigations

1. Risk: browser differences in OPFS/Web Locks/visibility behavior.
   Mitigation: capability matrix + conservative fallback behavior.

2. Risk: cross-collection write contention causes `SQLITE_BUSY`.
   Mitigation: serialize physical writes via `tsdb:writer:<dbName>` + bounded retry/backoff.

3. Risk: WASM startup overhead.
   Mitigation: lazy init + connection reuse per tab.

4. Risk: SQL pushdown mismatch vs query-engine semantics.
   Mitigation: equivalence tests + fallback filtering for unsupported fragments.

5. Risk: driver divergence across runtimes.
   Mitigation: strict adapter contract suite and minimal driver interface.

6. Risk: sync-absent follower mutation queuing during leader churn.
   Mitigation: durable RPC retry/backoff and idempotent mutation envelopes.

## Implementation Readiness Checklist

1. API:

- overload signatures compile and infer correctly for `sync` present/absent
- runtime branch matches compile-time discrimination (`options.sync != null`)

2. Core semantics:

- hydrate barrier + queued tx ordering implemented
- insert-to-update normalization implemented for sync-present path
- sync-absent auto-persist wrappers implemented

3. Coordinator:

- lock acquisition, heartbeat, timeout, and stepdown logic implemented
- protocol envelope and RPC correlation/idempotency implemented
- heartbeat carries `latestSeq` and followers perform `pullSince` catch-up

4. SQLite adapter:

- DDL initialization and schema-version checks implemented
- key encoding/decoding preserves string vs number identity
- identifier hashing/mapping prevents unsafe SQL identifiers
- pushdown planner + fallback filtering implemented
- applied tx idempotency table enforced
- tombstone per-key delete-state tracking implemented
- durable `leader_term` monotonicity and schema-version policy implemented
- corruption detection and reset utility implemented

5. Runtime adapters:

- browser OPFS adapter passes single-tab integration tests (Phase 7)
- browser multi-tab coordinator/election tests pass (Phase 8)
- node/electron/mobile (rn+expo) adapters passing contract suite
- cloudflare DO adapter passing integration suite

6. Test coverage:

- unit + contract + browser integration + DO integration green in CI

## Open Decisions

1. Electron renderer read policy: direct read vs strict main-process proxy.
2. Whether `ensureRemoteSubset` is always background or optionally awaited.

Blocking-before-implementation:

- none (runtime driver choices and package shape are fixed in this plan: Node/Electron `better-sqlite3`, `@tanstack/db-react-native-sqlite-persisted-collection` for RN/Expo via `op-sqlite`)

Blocking-before-browser phases:

- Phase 7: verify OPFS + `FileSystemSyncAccessHandle` in target evergreen browsers.
- Phase 8: verify Web Locks in the same target browsers.

Non-blocking (can be phased after initial implementation):

- electron renderer read policy refinements
- awaited vs background `ensureRemoteSubset` behavior toggle

## Notes and Implications

1. First-time index build has unavoidable cost; subsequent indexed reads are fast.
2. Local performance depends on index coverage; use `autoIndex` or explicit `createIndex(...)` on hot paths.
3. Reads never round-trip through leader; leader handles write serialization and sync responsibilities.
4. Sync-absent usage provides a persistence-first option without requiring remote sync wiring.
5. `loadSubset` currently returns materialized arrays; cursor/streaming read API can be explored after v1.
