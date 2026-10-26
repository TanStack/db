import {
  NoPendingSyncTransactionCommitError,
  NoPendingSyncTransactionWriteError,
  PERSISTED_READINESS,
  SYNC_PERSISTENCE_PROTOCOL,
  SYNC_PERSISTENCE_VERSION,
  SyncTransactionAbortedError,
  collectionOptionsClaim,
  compileSingleRowExpression,
  equalPersistedSnapshotValues,
  getLoadSubsetDemandKey,
  safeRandomUUID,
  toBooleanPredicate,
  waitForPersistedInitialRender,
  whenSyncAccepted,
  withAcceptedReceipt,
  withCollectionConfigFactory,
} from '@tanstack/db'
import {
  DuplicateRemoteSubsetOwnerError,
  IndeterminateCommitError,
  InvalidPersistedCollectionConfigError,
  InvalidPersistedCollectionCoordinatorError,
  InvalidPersistedStorageKeyEncodingError,
  InvalidPersistedStorageKeyError,
  InvalidPersistenceAdapterError,
  InvalidSyncConfigError,
  PersistedCollectionDurabilityError,
  toPersistedCollectionDurabilityError,
} from './errors'
import { serializeSQLiteBigInt, serializeSQLiteTemporal } from './sqlite-value'
import {
  toProcessLocalLoadSubsetOptions,
  toTransportedLoadSubsetOptions,
  validateRemoteSubsetOptions,
} from './remote-subset-wire'
import {
  reportRemoteSubsetOwnerError,
  unloadRemoteSubsetOwner,
} from './remote-subset-owner'
import type { TransportedLoadSubsetOptions } from './remote-subset-wire'
import type { RemoteSubsetOwner } from './remote-subset-owner'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  ChangeMessageOrDeleteKeyMessage,
  Collection,
  CollectionConfig,
  CollectionIndexMetadata,
  DeleteMutationFnParams,
  InferSchemaOutput,
  InsertMutationFnParams,
  LoadSubsetFn,
  LoadSubsetOptions,
  PendingMutation,
  PersistedReadinessSnapshot,
  PersistedReadinessSource,
  SyncAppliedReceipt,
  SyncConfig,
  SyncConfigRes,
  SyncMetadataApi,
  SyncPersistenceCapabilityV1,
  SyncPersistenceKeySetEvidence,
  SyncPersistenceScanOptions,
  UpdateMutationFnParams,
  UtilsRecord,
} from '@tanstack/db'

export type PersistedMutationEnvelope =
  | {
      mutationId: string
      type: `insert`
      key: string | number
      value: Record<string, unknown>
      /** Persisted row metadata, not optimistic-transaction metadata. */
      metadata?: unknown
      /** Whether this envelope replaces or deletes the persisted row metadata. */
      metadataChanged?: boolean
    }
  | {
      mutationId: string
      type: `update`
      key: string | number
      value: Record<string, unknown>
      /** Persisted row metadata, not optimistic-transaction metadata. */
      metadata?: unknown
      /** Whether this envelope replaces or deletes the persisted row metadata. */
      metadataChanged?: boolean
    }
  | {
      mutationId: string
      type: `delete`
      key: string | number
      value: Record<string, unknown>
    }

export type ProtocolEnvelope<TPayload> = {
  v: 1
  dbName: string
  collectionId: string
  senderId: string
  ts: number
  payload: TPayload
}

export type LeaderHeartbeat = {
  type: `leader:heartbeat`
  term: number
  leaderId: string
  latestSeq: number
  latestRowVersion: number
}

export type TxCommitted = {
  type: `tx:committed`
  term: number
  seq: number
  txId: string
  latestRowVersion: number
} & (
  | {
      requiresFullReload: true
      reconciliationReload?: true
    }
  | {
      requiresFullReload: false
      changedRows: Array<{
        key: string | number
        value: Record<string, unknown>
      }>
      deletedKeys: Array<string | number>
      rowMetadataMutations?: Array<
        PersistedRowMetadataMutation<string | number>
      >
      collectionMetadataMutations?: Array<PersistedCollectionMetadataMutation>
    }
)

export type EnsureRemoteSubsetRequest = {
  type: `rpc:ensureRemoteSubset:req`
  rpcId: string
  acquisitionId: string
  options: TransportedLoadSubsetOptions
}

export type EnsureRemoteSubsetResponse =
  | {
      type: `rpc:ensureRemoteSubset:res`
      rpcId: string
      ok: true
      leaderId: string
    }
  | {
      type: `rpc:ensureRemoteSubset:res`
      rpcId: string
      ok: false
      error: string
      retryable?: true
    }

export type ReleaseRemoteSubsetRequest = {
  type: `rpc:releaseRemoteSubset:req`
  rpcId: string
  acquisitionId: string
}

export type ReleaseRemoteSubsetResponse =
  | {
      type: `rpc:releaseRemoteSubset:res`
      rpcId: string
      ok: true
    }
  | {
      type: `rpc:releaseRemoteSubset:res`
      rpcId: string
      ok: false
      error: string
    }

export type ApplyLocalMutationsRequest = {
  type: `rpc:applyLocalMutations:req`
  rpcId: string
  envelopeId: string
  mutations: Array<PersistedMutationEnvelope>
}

export type ApplyLocalMutationsResponse =
  | {
      type: `rpc:applyLocalMutations:res`
      rpcId: string
      ok: true
      term: number
      seq: number
      latestRowVersion: number
      acceptedMutationIds: Array<string>
    }
  | {
      type: `rpc:applyLocalMutations:res`
      rpcId: string
      ok: false
      code: `NOT_LEADER` | `VALIDATION_ERROR` | `CONFLICT` | `TIMEOUT`
      error: string
    }
  | {
      type: `rpc:applyLocalMutations:res`
      rpcId: string
      ok: false
      code: `PERSISTENCE_ERROR`
      error: string
      sourceCode?: string | number
      path?: string | ReadonlyArray<string | number>
    }

export type ApplyCommittedTxRequest = {
  type: `rpc:applyCommittedTx:req`
  rpcId: string
  envelopeId: string
  tx: PersistedTx
}

export type ApplyCommittedTxResponse =
  | {
      type: `rpc:applyCommittedTx:res`
      rpcId: string
      ok: true
      term: number
      seq: number
      latestRowVersion: number
    }
  | {
      type: `rpc:applyCommittedTx:res`
      rpcId: string
      ok: false
      code: `NOT_LEADER` | `CONFLICT` | `TIMEOUT`
      error: string
    }
  | {
      type: `rpc:applyCommittedTx:res`
      rpcId: string
      ok: false
      code: `PERSISTENCE_ERROR`
      error: string
      sourceCode?: string | number
      path?: string | ReadonlyArray<string | number>
    }

/** The durable version read before a source transaction enters coordination. */
export type CommittedTxAnchor = {
  latestRowVersion: number
  resetEpoch: number
}

export type ReconcileCommittedTxResponse =
  | {
      type: `rpc:reconcileCommittedTx:res`
      rpcId: string
      ok: true
      alreadyApplied: boolean
      committed: { term: number; seq: number; rowVersion: number }
    }
  | {
      type: `rpc:reconcileCommittedTx:res`
      rpcId: string
      ok: false
      code: `NOT_LEADER` | `UNDETERMINED` | `PERSISTENCE_ERROR`
      error: string
      sourceCode?: string | number
      path?: string | ReadonlyArray<string | number>
    }

export type ReconciledCommittedTx =
  | {
      kind: `already-applied` | `applied-now`
      committed: { term: number; seq: number; rowVersion: number }
      latestRowVersion: number
    }
  | { kind: `unknown` }

export type PullSinceRequest = {
  type: `rpc:pullSince:req`
  rpcId: string
  fromRowVersion: number
}

export type PullSinceResponse =
  | {
      type: `rpc:pullSince:res`
      rpcId: string
      ok: true
      latestTerm: number
      latestSeq: number
      latestRowVersion: number
      requiresFullReload: true
    }
  | {
      type: `rpc:pullSince:res`
      rpcId: string
      ok: true
      latestTerm: number
      latestSeq: number
      latestRowVersion: number
      requiresFullReload: false
      changedKeys: Array<string | number>
      deletedKeys: Array<string | number>
      deltas?: Array<
        ReplayableTxDelta<Record<string, unknown>, string | number>
      >
    }
  | {
      type: `rpc:pullSince:res`
      rpcId: string
      ok: false
      error: string
    }

export type CollectionReset = {
  type: `collection:reset`
  schemaVersion: number
  resetEpoch: number
}

export interface PersistedIndexSpec {
  readonly expressionSql: ReadonlyArray<string>
  readonly whereSql?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type PersistedRowMetadataMutation<
  TKey extends string | number = string | number,
> = { type: `set`; key: TKey; value: unknown } | { type: `delete`; key: TKey }

export type PersistedCollectionMetadataMutation =
  { type: `set`; key: string; value: unknown } | { type: `delete`; key: string }

export type ReplayableTxDelta<
  T extends Record<string, unknown> = Record<string, unknown>,
  TKey extends string | number = string | number,
> = {
  txId: string
  latestRowVersion: number
  changedRows: Array<{ key: TKey; value: T }>
  deletedKeys: Array<TKey>
  rowMetadataMutations: Array<PersistedRowMetadataMutation<TKey>>
  collectionMetadataMutations: Array<PersistedCollectionMetadataMutation>
}

export type PersistedScannedRow<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> = {
  key: TKey
  value: T
  metadata?: unknown
}

export type PersistedRowScanOptions = SyncPersistenceScanOptions

export type PersistedKeySetEvidence = SyncPersistenceKeySetEvidence

export type PersistedCacheGenerationClaim = {
  storageCollectionId: string
  claimId: string
  /** Present when the adapter expires dormant claims. */
  expiresAtMs?: number
}

/** An eager Collection name or a claim-bound persisted cache generation. */
export type PersistedStorageTarget =
  | { kind: `eager`; collectionId: string }
  | {
      kind: `managed`
      storageCollectionId: string
      claimId: string
    }

export function eagerStorageTarget(
  collectionId: string,
): PersistedStorageTarget {
  return { kind: `eager`, collectionId }
}

export function managedStorageTarget(
  storageCollectionId: string,
  claimId: string,
): PersistedStorageTarget {
  return { kind: `managed`, storageCollectionId, claimId }
}

export function resolvePersistedStorageTarget(
  target: PersistedStorageTarget,
  legacyClaimId?: string,
): { collectionId: string; claimId?: string } {
  const input: unknown = target
  if (typeof input !== `object` || input === null) {
    throw new InvalidPersistedCollectionConfigError(
      `SQLite persistence requires an explicit eager or managed storage target`,
    )
  }
  const fields = input as Record<string, unknown>
  if (fields.kind === `eager`) {
    if (
      typeof fields.collectionId !== `string` ||
      fields.collectionId.trim().length === 0
    ) {
      throw new InvalidPersistedCollectionConfigError(
        `An eager storage target requires a nonempty collectionId`,
      )
    }
    if (
      legacyClaimId !== undefined ||
      `claimId` in fields ||
      `storageCollectionId` in fields
    ) {
      throw new InvalidPersistedCollectionConfigError(
        `An eager storage target cannot carry a persisted cache claim`,
      )
    }
    return { collectionId: fields.collectionId }
  }
  if (fields.kind !== `managed`) {
    throw new InvalidPersistedCollectionConfigError(
      `Unknown SQLite persistence storage target kind`,
    )
  }
  if (
    typeof fields.storageCollectionId !== `string` ||
    fields.storageCollectionId.trim().length === 0 ||
    typeof fields.claimId !== `string` ||
    fields.claimId.trim().length === 0
  ) {
    throw new InvalidPersistedCollectionConfigError(
      `A managed storage target requires a storageCollectionId and persisted cache claim`,
    )
  }
  if (`collectionId` in fields) {
    throw new InvalidPersistedCollectionConfigError(
      `A managed storage target cannot carry an eager collectionId`,
    )
  }
  if (legacyClaimId !== undefined && legacyClaimId !== fields.claimId) {
    throw new InvalidPersistedCollectionConfigError(
      `The persisted cache claim does not match its storage target`,
    )
  }
  return {
    collectionId: fields.storageCollectionId,
    claimId: fields.claimId,
  }
}

type PersistedResumeGeneration = {
  latestTerm: number
  latestSeq: number
  latestRowVersion: number
  resetEpoch: number
}

export type PersistencePullSinceResult =
  | {
      latestRowVersion: number
      requiresFullReload: true
    }
  | {
      latestRowVersion: number
      requiresFullReload: false
      changedKeys: Array<string | number>
      deletedKeys: Array<string | number>
      deltas?: Array<
        ReplayableTxDelta<Record<string, unknown>, string | number>
      >
    }

export type PersistedTx<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> = {
  txId: string
  term: number
  seq: number
  rowVersion: number
  /** Claim authorizing this transaction's persisted cache generation. */
  cacheGenerationClaimId?: string
  truncate?: boolean
  mutations: Array<
    | {
        type: `insert`
        key: TKey
        value: T
        metadata?: unknown
        metadataChanged?: boolean
      }
    | {
        type: `update`
        key: TKey
        value: T
        metadata?: unknown
        metadataChanged?: boolean
      }
    | { type: `delete`; key: TKey; value: T }
  >
  rowMetadataMutations?: Array<PersistedRowMetadataMutation<TKey>>
  collectionMetadataMutations?: Array<PersistedCollectionMetadataMutation>
}

/**
 * Opaque identity shared by every adapter over the same physical SQLite driver.
 * The core adapter uses it to serialize non-preemptible logical operations
 * while alternating one regular operation between queued hydrations.
 *
 * Delegating drivers must forward this property before they are passed to a
 * SQLite persistence adapter. A driver may also brand each returned Promise
 * with the same key for late capability discovery, but a wrapper must return
 * that exact Promise: discovering the key after a call cannot retroactively
 * schedule the wrapper's first logical operation.
 */
export const SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY = Symbol.for(
  `tanstack-db.sqlite-driver-supports-shared-logical-scheduling`,
)

export interface PersistenceAdapter {
  loadSubset: (
    target: PersistedStorageTarget,
    options: LoadSubsetOptions,
    ctx?: {
      requiredIndexSignatures?: ReadonlyArray<string>
      cacheGenerationClaimId?: string
    },
  ) => Promise<
    Array<{
      key: string | number
      value: Record<string, unknown>
      metadata?: unknown
    }>
  >
  loadResumeSnapshot: (
    target: PersistedStorageTarget,
    ctx?: {
      requiredIndexSignatures?: ReadonlyArray<string>
      includeRows?: boolean
      cacheGenerationClaimId?: string
    },
  ) => Promise<{
    rows: Array<{
      key: string | number
      value: Record<string, unknown>
      metadata?: unknown
    }>
    keySet?: PersistedKeySetEvidence
    collectionMetadata: Array<{ key: string; value: unknown }>
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
    resetEpoch: number
  }>
  applyCommittedTx: (
    target: PersistedStorageTarget,
    tx: PersistedTx,
  ) => Promise<void>
  claimCacheGeneration?: (
    collectionId: string,
  ) => Promise<PersistedCacheGenerationClaim>
  rotateCacheGeneration?: (
    collectionId: string,
    claimId: string,
    resetMetadata?: { key: string; value: unknown },
    expectedStorageCollectionId?: string,
  ) => Promise<PersistedCacheGenerationClaim>
  releaseCacheGenerationClaim?: (claimId: string) => Promise<void>
  renewCacheGenerationClaim?: (
    storageCollectionId: string,
    claimId: string,
  ) => Promise<number | undefined>
  getCacheGenerationNow?: () => number
  /** Atomically certify or apply one source transaction after a lost response. */
  reconcileCommittedTx?: (
    target: PersistedStorageTarget,
    tx: PersistedTx,
    anchor: CommittedTxAnchor,
  ) => Promise<ReconciledCommittedTx>
  loadCollectionMetadata?: (
    target: PersistedStorageTarget,
    ctx?: { cacheGenerationClaimId?: string },
  ) => Promise<Array<{ key: string; value: unknown }>>
  scanRows?: (
    target: PersistedStorageTarget,
    options?: PersistedRowScanOptions,
    ctx?: { cacheGenerationClaimId?: string },
  ) => Promise<Array<PersistedScannedRow>>
  ensureIndex: (
    target: PersistedStorageTarget,
    signature: string,
    spec: PersistedIndexSpec,
    ctx?: { cacheGenerationClaimId?: string },
  ) => Promise<void>
  markIndexRemoved?: (
    target: PersistedStorageTarget,
    signature: string,
    ctx?: { cacheGenerationClaimId?: string },
  ) => Promise<void>
  getStreamPosition?: (
    target: PersistedStorageTarget,
    ctx?: { cacheGenerationClaimId?: string },
  ) => Promise<{
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
  }>
  /** Reserve a new durable election term before announcing Browser leadership. */
  reserveLeadershipTerm?: (
    target: PersistedStorageTarget,
    observedTerm: number,
    ctx?: { cacheGenerationClaimId?: string },
  ) => Promise<{
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
  }>
  /**
   * Runs one complete logical hydrate as a non-preemptible scheduler unit.
   * The callback must use the supplied unscheduled adapter for all nested
   * persistence work and must not retain it after the callback settles.
   */
  runInHydrationScope?: <T>(
    task: (adapter: HydrationPersistenceAdapter) => Promise<T>,
  ) => Promise<T>
  /** Schedule one regular operation before it acquires external writer locks. */
  runInRegularScope?: RegularScope
  /** Whether hydration scopes currently enter a shared driver scheduler. */
  isHydrationScopeScheduled?: () => boolean
}

/**
 * Regular work on a shared driver scheduler. A scheduler that admits regular
 * work also orders it against hydrates, so the barrier is part of the same
 * capability rather than a separate optional member.
 */
export type RegularScope = (<T>(
  task: (adapter: HydrationPersistenceAdapter) => Promise<T>,
) => Promise<T>) & {
  /**
   * Resolves after every operation, in either lane, queued or running at the
   * call settles. It never rejects, takes no scheduler turn, and does not
   * count as a lane completion.
   */
  afterQueuedWork: () => Promise<void>
}

export type HydrationPersistenceAdapter = PersistenceAdapter & {
  pullSince?: (
    target: PersistedStorageTarget,
    fromRowVersion: number,
    ctx?: { cacheGenerationClaimId?: string },
  ) => Promise<PersistencePullSinceResult>
}

export type { RemoteSubsetOwner } from './remote-subset-owner'

type SingleProcessRemoteSubsetAcquisition = {
  owner: RemoteSubsetOwner
  options: TransportedLoadSubsetOptions
  load: Promise<void>
}

export interface SQLiteDriver {
  readonly [SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY]?: object
  /** Host-specific limit on bound parameters in one query, when lower than SQLite's. */
  readonly maxBoundParameters?: number
  exec: (sql: string) => Promise<void>
  query: <T>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ) => Promise<ReadonlyArray<T>>
  run: (sql: string, params?: ReadonlyArray<unknown>) => Promise<void>
  transaction: <T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ) => Promise<T>
  transactionWithDriver?: <T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ) => Promise<T>
}

/**
 * Forwards a driver's shared logical scheduling identity to a transparent
 * delegating driver before the wrapper is used by a persistence adapter.
 */
export function forwardSQLiteDriverSharedLogicalScheduling<
  TDriver extends SQLiteDriver,
>(source: SQLiteDriver, wrapper: TDriver): TDriver {
  const key = source[SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY]
  if (key) {
    Object.defineProperty(
      wrapper,
      SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
      { value: key },
    )
  }
  return wrapper
}

export interface PersistedCollectionCoordinator {
  getNodeId: () => string
  setAdapterForCollection?: (
    collectionId: string,
    adapter: PersistenceAdapter,
    cacheGenerationClaimId?: string,
  ) => void
  subscribe: (
    collectionId: string,
    onMessage: (message: ProtocolEnvelope<unknown>) => void,
  ) => () => void
  publish: (collectionId: string, message: ProtocolEnvelope<unknown>) => void
  isLeader: (collectionId: string) => boolean
  ensureLeadership: (collectionId: string) => Promise<void>
  requestEnsureRemoteSubset: (
    collectionId: string,
    options: LoadSubsetOptions,
  ) => Promise<void>
  requestReleaseRemoteSubset: (
    collectionId: string,
    options: LoadSubsetOptions,
  ) => Promise<void>
  registerRemoteSubsetOwner: (
    collectionId: string,
    owner: RemoteSubsetOwner,
  ) => () => void
  /**
   * Requests leader-side index creation. The scoped adapter is leader-local
   * and is never serialized to a follower. `localEnsureCompleted` lets the
   * built-in leader avoid repeating successful local work.
   */
  requestEnsurePersistedIndex: (
    collectionId: string,
    signature: string,
    spec: PersistedIndexSpec,
    scopedAdapter?: HydrationPersistenceAdapter,
    localEnsureCompleted?: boolean,
    cacheGenerationClaimId?: string,
  ) => Promise<void>
  requestApplyLocalMutations?: (
    collectionId: string,
    mutations: Array<PersistedMutationEnvelope>,
    cacheGenerationClaimId?: string,
  ) => Promise<ApplyLocalMutationsResponse>
  /**
   * Applies a committed transaction through the supplied adapter when present.
   * Wrappers must forward this leader-local loan: scheduling it again can wait
   * on the hydration that is awaiting this call. Never serialize or retain the
   * loan after the call; ordinary work uses the registered collection adapter.
   */
  requestApplyCommittedTx: (
    collectionId: string,
    tx: PersistedTx,
    scopedAdapter?: HydrationPersistenceAdapter,
  ) => Promise<ApplyCommittedTxResponse>
  /** Available only when the elected adapter can certify the durable outcome. */
  reconcileCommittedTx?: (
    collectionId: string,
    tx: PersistedTx,
    anchor: CommittedTxAnchor,
    scopedAdapter?: HydrationPersistenceAdapter,
  ) => Promise<ReconcileCommittedTxResponse>
  /** The scoped adapter is leader-local and is never serialized to a follower. */
  pullSince?: (
    collectionId: string,
    fromRowVersion: number,
    scopedAdapter?: HydrationPersistenceAdapter,
    cacheGenerationClaimId?: string,
  ) => Promise<PullSinceResponse>
}

export interface PersistedCollectionPersistence {
  adapter: PersistenceAdapter
  coordinator?: PersistedCollectionCoordinator
  resolvePersistenceForCollection?: (options: {
    collectionId: string
    mode: PersistedCollectionMode
    schemaVersion?: number
  }) => PersistedCollectionPersistence
  resolvePersistenceForMode?: (
    mode: PersistedCollectionMode,
  ) => PersistedCollectionPersistence
}

type PersistedResolvedPersistence = PersistedCollectionPersistence & {
  coordinator: PersistedCollectionCoordinator
}

export type PersistedCollectionLeadershipState = {
  nodeId: string
  isLeader: boolean
}

/** Local persistence owns these names; caller utility collisions throw. */
export interface PersistedCollectionUtils extends UtilsRecord {
  acceptMutations: (transaction: {
    mutations: Array<PendingMutation<Record<string, unknown>>>
  }) => Promise<void> | void
  getLeadershipState?: () => PersistedCollectionLeadershipState
  /** Hydrate once without acquiring a new ongoing subset lease. */
  forceReloadSubset?: (options: LoadSubsetOptions) => Promise<void> | void
}

class PersistedReadinessTracker implements PersistedReadinessSource {
  private snapshot: PersistedReadinessSnapshot = { status: `loading` }
  private networkDeadlineAt: number | undefined
  private readonly listeners = new Set<() => void>()

  constructor(readonly networkTimeoutMs: number) {}

  waitForInitialRender = waitForPersistedInitialRender

  getSnapshot = (): PersistedReadinessSnapshot => this.snapshot

  getOrStartNetworkDeadline = (): number => {
    return (this.networkDeadlineAt ??= Date.now() + this.networkTimeoutMs)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  set(snapshot: PersistedReadinessSnapshot): void {
    const deadlineRestarted =
      snapshot.status === `loading` && this.networkDeadlineAt !== undefined
    if (deadlineRestarted) {
      this.networkDeadlineAt = Date.now() + this.networkTimeoutMs
    }
    if (
      this.snapshot.status === snapshot.status &&
      this.snapshot.error === snapshot.error &&
      !deadlineRestarted
    ) {
      return
    }
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

export type PersistedInitialRenderOptions = {
  strategy: `network-first`
  /** Time to prefer network before restored rows may render; defaults to 3s. */
  networkTimeoutMs?: number
}

const DEFAULT_NETWORK_TIMEOUT_MS = 3_000
const CACHE_CLAIM_RENEW_WINDOW_MS = 60_000
const MAX_TIMER_TIMEOUT_MS = 2_147_483_647

function getNetworkTimeoutMs(
  initialRender: PersistedInitialRenderOptions | undefined,
): number | undefined {
  if (initialRender === undefined) return undefined
  const strategy = (initialRender as { strategy: unknown }).strategy
  if (strategy !== `network-first`) {
    throw new InvalidPersistedCollectionConfigError(
      `initialRender.strategy must be "network-first"`,
    )
  }
  const timeoutMs = initialRender.networkTimeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_TIMER_TIMEOUT_MS
  ) {
    throw new InvalidPersistedCollectionConfigError(
      `initialRender.networkTimeoutMs must be between 0 and ${MAX_TIMER_TIMEOUT_MS}`,
    )
  }
  return timeoutMs
}

export type PersistedSyncWrappedOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
> = CollectionConfig<T, TKey, TSchema, TUtils> & {
  sync: SyncConfig<T, TKey>
  persistence: PersistedCollectionPersistence
  schemaVersion?: number
  /** Opt into network-first rendering with a persisted fallback. */
  initialRender?: PersistedInitialRenderOptions
}

export type PersistedLocalOnlyOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
> = Omit<CollectionConfig<T, TKey, TSchema, TUtils>, `sync`> & {
  persistence: PersistedCollectionPersistence
  schemaVersion?: number
  /** Opt into network-first rendering with a persisted fallback. */
  initialRender?: PersistedInitialRenderOptions
}

type PersistedSyncOptionsResult<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1,
  TUtils extends UtilsRecord,
> = CollectionConfig<T, TKey, TSchema, TUtils> & {
  persistence: PersistedResolvedPersistence
}

type PersistedLocalOnlyOptionsResult<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1,
  TUtils extends UtilsRecord,
> = CollectionConfig<T, TKey, TSchema, TUtils & PersistedCollectionUtils> & {
  id: string
  persistence: PersistedResolvedPersistence
  utils: TUtils & PersistedCollectionUtils
}

const REQUIRED_COORDINATOR_METHODS: ReadonlyArray<
  keyof Pick<
    PersistedCollectionCoordinator,
    | `getNodeId`
    | `subscribe`
    | `publish`
    | `isLeader`
    | `ensureLeadership`
    | `requestEnsureRemoteSubset`
    | `requestReleaseRemoteSubset`
    | `registerRemoteSubsetOwner`
    | `requestEnsurePersistedIndex`
    | `requestApplyCommittedTx`
  >
> = [
  `getNodeId`,
  `subscribe`,
  `publish`,
  `isLeader`,
  `ensureLeadership`,
  `requestEnsureRemoteSubset`,
  `requestReleaseRemoteSubset`,
  `registerRemoteSubsetOwner`,
  `requestEnsurePersistedIndex`,
  `requestApplyCommittedTx`,
]

const REQUIRED_ADAPTER_METHODS: ReadonlyArray<
  keyof Pick<
    PersistenceAdapter,
    `loadSubset` | `loadResumeSnapshot` | `applyCommittedTx` | `ensureIndex`
  >
> = [`loadSubset`, `loadResumeSnapshot`, `applyCommittedTx`, `ensureIndex`]

const TARGETED_INVALIDATION_KEY_LIMIT = 128
const DEFAULT_DB_NAME = `tanstack-db`
const REMOTE_ENSURE_RETRY_DELAY_MS = 50

type SyncControlFns<T extends object, TKey extends string | number> = {
  begin: (() => void) | null
  write:
    | ((
        message:
          | { type: `insert`; value: T; metadata?: Record<string, unknown> }
          | { type: `update`; value: T; metadata?: Record<string, unknown> }
          | { type: `delete`; key: TKey },
      ) => void)
    | null
  commit: ((signal?: AbortSignal) => SyncAppliedReceipt) | null
  truncate: ((options?: { markReady?: boolean }) => void) | null
  metadata: SyncMetadataApi<TKey> | null
  markError: ((error: unknown) => void) | null
}

/**
 * Phase-0 coordinator implementation for single-process runtimes.
 * It satisfies the coordinator contract without cross-process transport.
 */
export class SingleProcessCoordinator implements PersistedCollectionCoordinator {
  private readonly nodeId: string
  private readonly collectionAdapters = new Map<string, PersistenceAdapter>()
  private readonly remoteSubsetOwners = new Map<string, RemoteSubsetOwner>()
  private readonly remoteSubsetAcquisitions = new Map<
    string,
    Map<LoadSubsetOptions, SingleProcessRemoteSubsetAcquisition>
  >()

  constructor(nodeId: string = safeRandomUUID()) {
    this.nodeId = nodeId
  }

  public getNodeId(): string {
    return this.nodeId
  }

  public subscribe(): () => void {
    return () => {}
  }

  public publish(): void {}

  public isLeader(): boolean {
    return true
  }

  public async ensureLeadership(): Promise<void> {}

  public async requestEnsureRemoteSubset(
    collectionId: string,
    options: LoadSubsetOptions,
  ): Promise<void> {
    const transported = toTransportedLoadSubsetOptions(options)
    const localOptions = toProcessLocalLoadSubsetOptions(options, transported)
    const owner = this.remoteSubsetOwners.get(collectionId)
    if (!owner) {
      throw new InvalidPersistedCollectionConfigError(
        `SingleProcessCoordinator has no remote subset owner configured for collection "${collectionId}"`,
      )
    }
    let acquisitions = this.remoteSubsetAcquisitions.get(collectionId)
    if (!acquisitions) {
      acquisitions = new Map()
      this.remoteSubsetAcquisitions.set(collectionId, acquisitions)
    }
    const existing = acquisitions.get(options)
    if (existing) {
      await existing.load
      return
    }

    let resolveLoad!: () => void
    let rejectLoad!: (error: unknown) => void
    const load = new Promise<void>((resolve, reject) => {
      resolveLoad = resolve
      rejectLoad = reject
    })
    acquisitions.set(options, { owner, options: localOptions, load })
    try {
      const ownerLoad = owner(localOptions)
      void Promise.resolve(ownerLoad).then(resolveLoad, (error) => {
        reportRemoteSubsetOwnerError(owner, error)
        rejectLoad(error)
      })
    } catch (error) {
      reportRemoteSubsetOwnerError(owner, error)
      rejectLoad(error)
    }
    await load
  }

  public async requestReleaseRemoteSubset(
    collectionId: string,
    options: LoadSubsetOptions,
  ): Promise<void> {
    const acquisitions = this.remoteSubsetAcquisitions.get(collectionId)
    const acquisition = acquisitions?.get(options)
    if (!acquisition) return
    acquisitions!.delete(options)
    if (acquisitions!.size === 0) {
      this.remoteSubsetAcquisitions.delete(collectionId)
    }
    // The owner may need unload to settle its load. The call itself already
    // transferred the lease, so waiting for load here can deadlock recovery.
    await unloadRemoteSubsetOwner(acquisition.owner, acquisition.options)
  }

  public registerRemoteSubsetOwner(
    collectionId: string,
    owner: RemoteSubsetOwner,
  ): () => void {
    if (this.remoteSubsetOwners.has(collectionId)) {
      throw new DuplicateRemoteSubsetOwnerError(collectionId)
    }
    this.remoteSubsetOwners.set(collectionId, owner)
    return () => {
      if (this.remoteSubsetOwners.get(collectionId) !== owner) return
      const acquisitions = this.remoteSubsetAcquisitions.get(collectionId)
      this.remoteSubsetAcquisitions.delete(collectionId)
      this.remoteSubsetOwners.delete(collectionId)
      for (const acquisition of acquisitions?.values() ?? []) {
        void unloadRemoteSubsetOwner(owner, acquisition.options).catch(
          () => undefined,
        )
      }
    }
  }

  public async requestEnsurePersistedIndex(): Promise<void> {}

  public setAdapterForCollection(
    collectionId: string,
    adapter: PersistenceAdapter,
  ): void {
    this.collectionAdapters.set(collectionId, adapter)
  }

  public async requestApplyCommittedTx(
    collectionId: string,
    tx: PersistedTx,
    scopedAdapter?: HydrationPersistenceAdapter,
  ): Promise<ApplyCommittedTxResponse> {
    const adapter = scopedAdapter ?? this.collectionAdapters.get(collectionId)
    if (!adapter) {
      throw new InvalidPersistedCollectionConfigError(
        `SingleProcessCoordinator has no persistence adapter configured for collection "${collectionId}"`,
      )
    }

    try {
      await adapter.applyCommittedTx(
        tx.cacheGenerationClaimId
          ? managedStorageTarget(collectionId, tx.cacheGenerationClaimId)
          : eagerStorageTarget(collectionId),
        tx,
      )
    } catch (error) {
      throw toPersistedCollectionDurabilityError(collectionId, error)
    }
    return {
      type: `rpc:applyCommittedTx:res`,
      rpcId: safeRandomUUID(),
      ok: true,
      term: tx.term,
      seq: tx.seq,
      latestRowVersion: tx.rowVersion,
    }
  }

  public pullSince(): Promise<PullSinceResponse> {
    return Promise.resolve({
      type: `rpc:pullSince:res`,
      rpcId: safeRandomUUID(),
      ok: true,
      latestTerm: 1,
      latestSeq: 0,
      latestRowVersion: 0,
      requiresFullReload: false,
      changedKeys: [],
      deletedKeys: [],
      deltas: [],
    })
  }
}

export function validatePersistedCollectionCoordinator(
  coordinator: PersistedCollectionCoordinator,
): void {
  for (const method of REQUIRED_COORDINATOR_METHODS) {
    if (typeof coordinator[method] !== `function`) {
      throw new InvalidPersistedCollectionCoordinatorError(method)
    }
  }
}

function validatePersistenceAdapter(adapter: PersistenceAdapter): void {
  for (const method of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter[method] !== `function`) {
      throw new InvalidPersistenceAdapterError(method)
    }
  }
}

function resolvePersistence(
  persistence: PersistedCollectionPersistence,
  collectionId: string,
): PersistedResolvedPersistence {
  validatePersistenceAdapter(persistence.adapter)

  const coordinator = persistence.coordinator ?? new SingleProcessCoordinator()
  if (coordinator instanceof SingleProcessCoordinator) {
    coordinator.setAdapterForCollection(collectionId, persistence.adapter)
  }
  validatePersistedCollectionCoordinator(coordinator)

  return {
    ...persistence,
    coordinator,
  }
}

function resolvePersistenceForMode(
  persistence: PersistedCollectionPersistence,
  mode: PersistedCollectionMode,
  collectionId: string,
): PersistedResolvedPersistence {
  const modeSpecificPersistence = persistence.resolvePersistenceForMode?.(mode)
  return resolvePersistence(
    modeSpecificPersistence ?? persistence,
    collectionId,
  )
}

function resolvePersistenceForCollection(
  persistence: PersistedCollectionPersistence,
  options: {
    collectionId: string
    mode: PersistedCollectionMode
    schemaVersion?: number
  },
): PersistedResolvedPersistence {
  const collectionSpecificPersistence =
    persistence.resolvePersistenceForCollection?.(options)
  if (collectionSpecificPersistence) {
    return resolvePersistence(
      collectionSpecificPersistence,
      options.collectionId,
    )
  }

  return resolvePersistenceForMode(
    persistence,
    options.mode,
    options.collectionId,
  )
}

function hasOwnSyncKey(options: object): options is { sync: unknown } {
  return Object.prototype.hasOwnProperty.call(options, `sync`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null
}

function isValidSyncConfig(value: unknown): value is SyncConfig<object> {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.sync === `function`
}

export type PersistedCollectionMode = `sync-present` | `sync-absent`
type PersistedMode = PersistedCollectionMode

type NormalizedSyncOperation<T extends object, TKey extends string | number> =
  | {
      type: `update`
      key: TKey
      value: T
      metadata?: Record<string, unknown>
    }
  | {
      type: `delete`
      key: TKey
      value: T
    }

type MetadataWrite = { type: `set`; value: unknown } | { type: `delete` }

function applyMetadataWrite<K>(
  target:
    | { set: (key: K, value: unknown) => unknown; delete: (key: K) => unknown }
    | undefined,
  key: K,
  write: MetadataWrite,
): void {
  if (write.type === `delete`) target?.delete(key)
  else target?.set(key, write.value)
}

function toMetadataMutations<K>(
  writes: Map<K, MetadataWrite>,
): Array<{ type: `set`; key: K; value: unknown } | { type: `delete`; key: K }> {
  return Array.from(writes, ([key, write]) =>
    write.type === `delete`
      ? { type: `delete`, key }
      : { type: `set`, key, value: write.value },
  )
}

type BufferedSyncTransaction<T extends object, TKey extends string | number> = {
  operations: Array<NormalizedSyncOperation<T, TKey>>
  partialUpdateOperationIndexes: Set<number>
  rowMetadataWrites: Map<TKey, MetadataWrite>
  collectionMetadataWrites: Map<string, MetadataWrite>
  deferredHydrationMetadataDeleteKeys: Set<TKey>
  hydrationContext?: { suppliedRowKeys: Set<TKey> }
  hydrationSequence?: number
  truncate: boolean
  internal: boolean
  lifecycleGeneration: number
  admittedStorageCollectionId?: string
  expectedResumeGenerationOwner?: symbol
  signal?: AbortSignal
  prependHydrationRows: (
    rows: Array<{ key: TKey; value: T; metadata?: unknown }>,
  ) => void
  applyToCollection: () => SyncAppliedReceipt
  shouldFailStopOnAbort?: () => boolean
  resolveApplied?: () => void
  rejectApplied?: (error: unknown) => void
}

type OpenSyncTransaction<T extends object, TKey extends string | number> = Omit<
  BufferedSyncTransaction<T, TKey>,
  `applyToCollection` | `prependHydrationRows` | `shouldFailStopOnAbort`
> & {
  signal?: AbortSignal
  applicationReceipt?: SyncAppliedReceipt
  operationKeys: Set<TKey>
  queuedBecauseHydrating: boolean
  // Set by `reserveCommitTurn`: subset hydration waits for this commit.
  reservesCommitTurn?: boolean
  hasDependentSuccessor: boolean
  publicationAdmissionWaiters?: Set<{
    resolve: () => void
    reject: (error: unknown) => void
  }>
  terminalFailure?: { error: unknown }
  // Set just before the transaction is handed to the Collection; from then
  // on core holds its keys itself.
  handedToCollection?: boolean
}

type SyncWriteNormalization<T extends object, TKey extends string | number> = {
  operation: NormalizedSyncOperation<T, TKey>
}

class ApplyMutex {
  private queue: Promise<void> = Promise.resolve()
  private pending = 0

  reserve(): {
    run: <T>(task: () => Promise<T> | T) => Promise<T>
  } {
    const runImmediately = this.pending === 0
    const predecessor = this.queue
    this.pending++

    let releaseReservation!: () => void
    const reservation = new Promise<void>((resolve) => {
      releaseReservation = resolve
    })
    this.queue = runImmediately
      ? reservation
      : predecessor.then(() => reservation)

    let used = false
    return {
      run: <T>(task: () => Promise<T> | T): Promise<T> => {
        if (used) {
          return Promise.reject(
            new Error(`an apply-mutex reservation can only run once`),
          )
        }
        used = true

        let taskPromise: Promise<T>
        if (runImmediately) {
          try {
            taskPromise = Promise.resolve(task())
          } catch (error) {
            taskPromise = Promise.reject(error)
          }
        } else {
          taskPromise = predecessor.then(() => task())
        }
        const markComplete = () => {
          this.pending--
          releaseReservation()
        }
        void taskPromise.then(markComplete, markComplete)
        return taskPromise
      },
    }
  }

  run<T>(task: () => Promise<T> | T): Promise<T> {
    return this.reserve().run(task)
  }
}

function matchesAnySubset(
  value: object,
  evaluators: ReadonlyArray<ReturnType<
    typeof compileSingleRowExpression
  > | null>,
): boolean {
  return evaluators.some(
    (evaluator) =>
      !evaluator ||
      toBooleanPredicate(
        evaluator(value as Record<string, unknown>) as boolean | null,
      ),
  )
}

function toStableSerializable(value: unknown): unknown {
  if (value == null) {
    return value
  }

  switch (typeof value) {
    case `string`:
    case `number`:
    case `boolean`:
      return value
    case `bigint`:
      return serializeSQLiteBigInt(value)
    case `function`:
    case `symbol`:
    case `undefined`:
      return undefined
  }

  const temporal = serializeSQLiteTemporal(value)
  if (temporal) return temporal

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => toStableSerializable(entry))
      .filter((entry) => entry !== undefined)
  }

  if (value instanceof Set) {
    return Array.from(value)
      .map((entry) => toStableSerializable(entry))
      .filter((entry) => entry !== undefined)
      .sort((left, right) => {
        const leftSerialized = JSON.stringify(left)
        const rightSerialized = JSON.stringify(right)
        return leftSerialized < rightSerialized
          ? -1
          : leftSerialized > rightSerialized
            ? 1
            : 0
      })
  }

  if (value instanceof Map) {
    return Array.from(value.entries())
      .map(([key, mapValue]) => ({
        key: toStableSerializable(key),
        value: toStableSerializable(mapValue),
      }))
      .filter((entry) => entry.key !== undefined && entry.value !== undefined)
      .sort((left, right) => {
        const leftSerialized = JSON.stringify(left.key)
        const rightSerialized = JSON.stringify(right.key)
        return leftSerialized < rightSerialized
          ? -1
          : leftSerialized > rightSerialized
            ? 1
            : 0
      })
  }

  const record = value as Record<string, unknown>
  const orderedKeys = Object.keys(record).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  const serializableRecord: Record<string, unknown> = {}
  for (const key of orderedKeys) {
    const serializableValue = toStableSerializable(record[key])
    if (serializableValue !== undefined) {
      serializableRecord[key] = serializableValue
    }
  }
  return serializableRecord
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(toStableSerializable(value) ?? null)
}

function normalizeSyncFnResult(result: void | (() => void) | SyncConfigRes) {
  if (typeof result === `function`) {
    return { cleanup: result } satisfies SyncConfigRes
  }

  if (result === undefined) {
    return {} satisfies SyncConfigRes
  }

  return result
}

function isTxCommittedPayload(payload: unknown): payload is TxCommitted {
  if (!isRecord(payload) || payload.type !== `tx:committed`) {
    return false
  }

  if (
    typeof payload.term !== `number` ||
    typeof payload.seq !== `number` ||
    typeof payload.txId !== `string` ||
    typeof payload.latestRowVersion !== `number` ||
    typeof payload.requiresFullReload !== `boolean`
  ) {
    return false
  }

  if (payload.requiresFullReload) {
    return (
      payload.reconciliationReload === undefined ||
      payload.reconciliationReload === true
    )
  }

  return (
    Array.isArray(payload.changedRows) &&
    Array.isArray(payload.deletedKeys) &&
    (payload.rowMetadataMutations === undefined ||
      Array.isArray(payload.rowMetadataMutations)) &&
    (payload.collectionMetadataMutations === undefined ||
      Array.isArray(payload.collectionMetadataMutations))
  )
}

function isCollectionResetPayload(
  payload: unknown,
): payload is CollectionReset {
  return (
    isRecord(payload) &&
    payload.type === `collection:reset` &&
    typeof payload.schemaVersion === `number` &&
    typeof payload.resetEpoch === `number`
  )
}

function toPersistedMutationEnvelope(
  mutation: PendingMutation<Record<string, unknown>>,
): PersistedMutationEnvelope {
  const key = mutation.key as string | number
  const value =
    mutation.type === `delete`
      ? (mutation.original as Record<string, unknown>)
      : mutation.modified

  // PendingMutation.metadata belongs to the optimistic transaction and is
  // consumed by mutation handlers. It must not overwrite persisted row metadata.
  return {
    mutationId: mutation.mutationId,
    type: mutation.type,
    key,
    value,
  }
}

class PersistedCollectionRuntime<
  T extends object,
  TKey extends string | number,
> {
  private readonly applyMutex = new ApplyMutex()
  private readonly activeSubsets = new Map<string, LoadSubsetOptions>()
  private activeHydrationContext: { suppliedRowKeys: Set<TKey> } | undefined
  private hydrationSequence = 0
  // An unscheduled startup read may finish after a coordinator reset publishes.
  private resetSequence = 0
  private readonly pendingRemoteSubsetEnsures = new Map<
    string,
    LoadSubsetOptions
  >()
  private readonly scopedRefreshes = new Map<LoadSubsetOptions, string>()
  /** A retained demand may use fresh physical request data after rotation. */
  private readonly rotatedAcquisitions = new Map<
    LoadSubsetOptions,
    LoadSubsetOptions
  >()
  /** An in-flight load waits for the recovery acquisition of its demand. */
  private readonly rotatedEnsures = new WeakMap<
    LoadSubsetOptions,
    Promise<void>
  >()
  private readonly queuedHydrationTransactions: Array<
    BufferedSyncTransaction<T, TKey>
  > = []
  private readonly queuedTxCommitted: Array<{
    txCommitted: TxCommitted
    lifecycleGeneration: number
    storageCollectionId: string
  }> = []
  private readonly requestIds = new WeakMap<LoadSubsetOptions, string>()
  private readonly hydratedDemands = new Set<string | undefined>()

  private collection: Collection<T, TKey, PersistedCollectionUtils> | null =
    null
  // Cleanup ends the active sync run, but cannot transfer this runtime's owner.
  private boundCollection: Collection<
    T,
    TKey,
    PersistedCollectionUtils
  > | null = null
  private syncControls: SyncControlFns<T, TKey> = {
    begin: null,
    write: null,
    commit: null,
    truncate: null,
    metadata: null,
    markError: null,
  }
  private startupMetadataPromise: Promise<void> | null = null
  private startPromise: Promise<void> | null = null
  private hasAttemptedStartup = false
  private resumeBaselinePromise: Promise<void> | null = null
  private resumeCertificationPromise: Promise<void> | null = null
  private persistedKeySetEvidence: PersistedKeySetEvidence | undefined
  private persistedResumeGeneration: PersistedResumeGeneration | undefined
  private resumeGenerationOwner = Symbol(`persisted resume generation owner`)
  private lifecycleGeneration = 0
  private internalApplyDepth = 0
  private appliedReceiptSequence = 0
  private syncErrorReported = false
  private reportedSyncError: unknown
  private readonly pendingAppliedReceipts = new Map<number, Promise<void>>()
  private hydratingGeneration: number | null = null
  private terminalFailure:
    { lifecycleGeneration: number; error: unknown } | undefined
  private coordinatorUnsubscribe: (() => void) | null = null
  private remoteSubsetOwnerUnsubscribe: (() => void) | null = null
  private indexAddedUnsubscribe: (() => void) | null = null
  private indexRemovedUnsubscribe: (() => void) | null = null
  private remoteEnsureRetryTimer: ReturnType<typeof setTimeout> | null = null
  private cacheClaimRenewTimer: ReturnType<typeof setTimeout> | null = null
  private cacheClaimRecovery: Promise<void> | null = null
  private nextRequestId = 0
  private startupSettled = false
  private sourceTruncateGeneration = 0
  /** Durable rows cannot replace source rows during scoped recovery. */
  private scopedRecovery = false
  private scopedRecoveryPending = false
  private scopedRecoverySequence = 0
  private recoverQueuedAfterLocalLoadFailure = false
  private cacheGenerationClaim: PersistedCacheGenerationClaim | undefined
  private startupCacheGenerationRotated = false
  private remoteSubsetOwner: RemoteSubsetOwner | undefined
  // Undefined before source assignment; null means the source cannot restart.
  private restartSourceAfterScopedRecovery:
    ((cacheRotated: Promise<void>) => void | Promise<void>) | null | undefined

  private latestTerm = 0
  private latestSeq = 0
  private latestRowVersion = 0
  // A metadata-only resume snapshot can advance latestRowVersion without
  // publishing rows. Gap checks must use the last publicly applied version.
  private publicRowVersion = 0
  // A reset does not label later tx notifications with their reset epoch.
  // Old-term payloads must be checked against durable rows even after a new term.
  private resetTermFence: number | undefined
  private localTerm = 1
  private localSeq = 0
  private localRowVersion = 0

  constructor(
    private readonly mode: PersistedMode,
    private readonly collectionId: string,
    private readonly persistence: PersistedResolvedPersistence,
    private readonly syncMode: `eager` | `on-demand`,
    private readonly dbName: string,
    private readonly persistedReadiness?: PersistedReadinessTracker,
    private readonly optionsClaim?: () => void | (() => void),
  ) {}

  private get storageCollectionId(): string {
    return this.cacheGenerationClaim?.storageCollectionId ?? this.collectionId
  }

  private storageTargetFor(
    storageCollectionId: string = this.storageCollectionId,
    claimId: string | undefined = this.cacheGenerationClaim?.claimId,
  ): PersistedStorageTarget {
    if (
      this.mode === `sync-present` &&
      this.syncMode === `on-demand` &&
      this.persistence.adapter.claimCacheGeneration
    ) {
      if (!claimId) {
        throw new InvalidPersistedCollectionConfigError(
          `A managed on-demand cache operation requires a persisted cache claim`,
        )
      }
      return { kind: `managed`, storageCollectionId, claimId }
    }
    return { kind: `eager`, collectionId: storageCollectionId }
  }

  private cacheGenerationNow(): number {
    return this.persistence.adapter.getCacheGenerationNow?.() ?? Date.now()
  }

  private hasExpiredCacheClaim(): boolean {
    const expiresAtMs = this.cacheGenerationClaim?.expiresAtMs
    return expiresAtMs !== undefined && this.cacheGenerationNow() >= expiresAtMs
  }

  private async claimCacheGeneration(
    lifecycleGeneration: number,
  ): Promise<void> {
    if (this.mode !== `sync-present` || this.syncMode !== `on-demand`) return
    const adapter = this.persistence.adapter
    const capabilities = [
      adapter.claimCacheGeneration,
      adapter.rotateCacheGeneration,
      adapter.renewCacheGenerationClaim,
      adapter.releaseCacheGenerationClaim,
    ]
    if (capabilities.some(Boolean) && !capabilities.every(Boolean)) {
      throw new InvalidPersistedCollectionConfigError(
        `An on-demand managed cache generation adapter must implement claimCacheGeneration, rotateCacheGeneration, renewCacheGenerationClaim, and releaseCacheGenerationClaim together`,
      )
    }
    if (!adapter.claimCacheGeneration) return
    const claim = await adapter.claimCacheGeneration(this.collectionId)
    if (lifecycleGeneration !== this.lifecycleGeneration) {
      await adapter.releaseCacheGenerationClaim?.(claim.claimId)
      return
    }
    this.cacheGenerationClaim = claim
    this.scheduleCacheClaimRenewal(claim)
    this.attachCoordinatorSubscription()
  }

  private clearCacheClaimRenewal(): void {
    if (this.cacheClaimRenewTimer !== null) {
      clearTimeout(this.cacheClaimRenewTimer)
      this.cacheClaimRenewTimer = null
    }
  }

  private scheduleCacheClaimRenewal(
    claim: PersistedCacheGenerationClaim,
  ): void {
    this.clearCacheClaimRenewal()
    if (
      claim.expiresAtMs === undefined ||
      !this.persistence.adapter.renewCacheGenerationClaim
    ) {
      return
    }
    const remaining = claim.expiresAtMs - this.cacheGenerationNow()
    const delay =
      remaining <= 0
        ? 1_000
        : Math.max(
            1,
            Math.min(CACHE_CLAIM_RENEW_WINDOW_MS, Math.floor(remaining / 2)),
          )
    const lifecycleGeneration = this.lifecycleGeneration
    this.cacheClaimRenewTimer = setTimeout(() => {
      this.cacheClaimRenewTimer = null
      void this.ensureCacheClaimActive().catch(() => {
        // A failed renewal does not establish claim loss. Adapter reads and
        // writes still check the claim; retry the background check without
        // turning one transient storage error into a permanent Collection
        // failure. An expired claim retries at a bounded pace.
        if (
          lifecycleGeneration === this.lifecycleGeneration &&
          this.cacheGenerationClaim === claim
        ) {
          this.scheduleCacheClaimRenewal(claim)
        }
      })
    }, delay)
  }

  private async ensureCacheClaimActive(): Promise<void> {
    if (this.cacheClaimRecovery) {
      await this.cacheClaimRecovery
      return
    }
    if (await this.renewCacheClaim(this.persistence.adapter)) return
    // Another caller may have started recovery while renewal was awaited.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!this.cacheClaimRecovery) {
      const recovery =
        this.restartSourceAfterScopedRecovery === undefined
          ? this.reclaimStartupCacheGeneration()
          : this.startScopedRecovery()
      this.cacheClaimRecovery = recovery
      void recovery
        .finally(() => {
          if (this.cacheClaimRecovery === recovery) {
            this.cacheClaimRecovery = null
          }
        })
        .catch(() => undefined)
    }
    await this.cacheClaimRecovery
  }

  private scheduleCacheClaimRecovery(lifecycleGeneration: number): void {
    // Recovery may need the apply mutex held by the caller. Let that caller
    // release its turn before checking the claim and rotating the cache.
    queueMicrotask(() => {
      if (lifecycleGeneration !== this.lifecycleGeneration) return
      void this.ensureCacheClaimActive()
        .then(() =>
          this.applyMutex.run(() => this.flushQueuedTxCommittedUnsafe()),
        )
        .catch((error) => {
          this.markTerminalFailure(error, lifecycleGeneration)
        })
    })
  }

  private async reclaimStartupCacheGeneration(): Promise<void> {
    const lifecycleGeneration = this.lifecycleGeneration
    const previous = this.cacheGenerationClaim
    if (!previous) return
    if (!this.persistence.adapter.rotateCacheGeneration) {
      throw new InvalidPersistedCollectionConfigError(
        `A managed on-demand cache adapter must rotate expired startup claims`,
      )
    }
    this.clearCacheClaimRenewal()
    this.coordinatorUnsubscribe?.()
    this.coordinatorUnsubscribe = null
    const rotated = await this.persistence.adapter.rotateCacheGeneration(
      this.collectionId,
      previous.claimId,
      undefined,
      previous.storageCollectionId,
    )
    if (lifecycleGeneration !== this.lifecycleGeneration) {
      await this.persistence.adapter.releaseCacheGenerationClaim?.(
        rotated.claimId,
      )
      return
    }
    this.cacheGenerationClaim = rotated
    this.startupCacheGenerationRotated = true
    this.resetSequence++
    this.latestTerm = 0
    this.latestSeq = 0
    this.latestRowVersion = 0
    this.localTerm = 1
    this.localSeq = 0
    this.localRowVersion = 0
    this.persistedResumeGeneration = undefined
    this.persistedKeySetEvidence = { status: `incompatible` }
    this.scheduleCacheClaimRenewal(rotated)
    this.attachCoordinatorSubscription()
  }

  private async renewCacheClaim(
    adapter: HydrationPersistenceAdapter,
  ): Promise<boolean> {
    const claim = this.cacheGenerationClaim
    if (
      !claim ||
      !adapter.renewCacheGenerationClaim ||
      this.scopedRecoveryPending
    )
      return true
    if (
      claim.expiresAtMs !== undefined &&
      claim.expiresAtMs - this.cacheGenerationNow() >
        CACHE_CLAIM_RENEW_WINDOW_MS
    ) {
      // Durable operations check their claim at the adapter boundary. Keep
      // the background timer armed without writing the same live claim for
      // every foreground operation.
      if (this.cacheClaimRenewTimer === null) {
        this.scheduleCacheClaimRenewal(claim)
      }
      return true
    }
    const lifecycleGeneration = this.lifecycleGeneration
    const expiresAtMs = await adapter.renewCacheGenerationClaim(
      claim.storageCollectionId,
      claim.claimId,
    )
    if (
      lifecycleGeneration !== this.lifecycleGeneration ||
      this.cacheGenerationClaim?.claimId !== claim.claimId ||
      this.cacheGenerationClaim.storageCollectionId !==
        claim.storageCollectionId
    ) {
      return true
    }
    if (expiresAtMs === undefined) {
      return false
    }
    this.cacheGenerationClaim = { ...claim, expiresAtMs }
    this.scheduleCacheClaimRenewal(this.cacheGenerationClaim)
    return true
  }

  setSyncControls(syncControls: SyncControlFns<T, TKey>): void {
    this.advanceLifecycle()
    this.syncErrorReported = false
    this.reportedSyncError = undefined

    const commit = syncControls.commit
    this.syncControls = {
      ...syncControls,
      commit: commit
        ? (signal) => this.trackAppliedReceipt(commit(signal))
        : null,
    }
  }

  setSourceRestartAfterScopedRecovery(
    restart:
      ((cacheRotated: Promise<void>) => void | Promise<void>) | undefined,
  ): void {
    this.restartSourceAfterScopedRecovery = restart ?? null
  }

  clearSourceRestartAfterScopedRecovery(): void {
    this.restartSourceAfterScopedRecovery = undefined
  }

  reportSyncError(error: unknown): unknown {
    const markError = this.syncControls.markError
    if (this.syncErrorReported) return this.reportedSyncError
    if (!markError) return error

    this.syncErrorReported = true
    this.reportedSyncError = error
    try {
      markError(error)
    } catch {
      // Reporting must not replace the original asynchronous failure.
    }
    return error
  }

  registerRemoteSubsetOwner(owner: RemoteSubsetOwner): void {
    this.remoteSubsetOwnerUnsubscribe?.()
    this.remoteSubsetOwner = owner
    this.remoteSubsetOwnerUnsubscribe =
      this.persistence.coordinator.registerRemoteSubsetOwner(
        this.storageCollectionId,
        owner,
      )
  }

  private trackAppliedReceipt(receipt: SyncAppliedReceipt): SyncAppliedReceipt {
    const sequence = ++this.appliedReceiptSequence
    if (receipt === true) {
      return true
    }
    this.pendingAppliedReceipts.set(sequence, receipt)
    const removeReceipt = () => this.pendingAppliedReceipts.delete(sequence)
    void receipt.then(removeReceipt, removeReceipt)
    return receipt
  }

  // Startup waits for acceptance: a local mutation's handler can wait for
  // startup, and the rows publish when that mutation settles. Readiness waits
  // for them in core. A subset load waits for visibility.
  private async waitForAppliedReceiptsAfter(
    cursor: number,
    until: `accepted` | `visible` = `visible`,
  ): Promise<void> {
    await Promise.all(
      Array.from(this.pendingAppliedReceipts, ([sequence, receipt]) =>
        sequence <= cursor
          ? undefined
          : until === `accepted`
            ? whenSyncAccepted(receipt)
            : receipt,
      ),
    )
  }

  // An ensure reply settles a follower's load (law 7). A source's loadSubset
  // must await every commit receipt that establishes its result, so the
  // leader broadcasts those commits before it replies on the same channel.
  // They are already queued on the apply mutex; settle after they show here.
  private async applyLeaderCommitsBeforeReply(
    options: LoadSubsetOptions,
  ): Promise<void> {
    try {
      // Commits kept while the claim was expired apply after it is active.
      if (this.hasExpiredCacheClaim() || this.cacheClaimRecovery) {
        await this.ensureCacheClaimActive()
      }
      await this.applyMutex.run(() => this.flushQueuedTxCommittedUnsafe())
      // A broadcast that failed to apply made the runtime terminal; its rows
      // are not visible, so the load must not settle successfully.
      this.throwIfTerminal()
    } catch (error) {
      // A terminal runtime releases the acquisition the owner granted the
      // load. Otherwise, as after a failed ensure, the demand retries.
      if (this.getCurrentTerminalFailure()) this.unloadSubset(options)
      else this.queueRemoteSubsetEnsure(options)
      throw error
    }
  }

  private clearSyncControls(): void {
    this.syncControls = {
      begin: null,
      write: null,
      commit: null,
      truncate: null,
      metadata: null,
      markError: null,
    }
  }

  isHydratingNow(): boolean {
    return this.hydratingGeneration === this.lifecycleGeneration
  }

  getActiveHydrationContext(): { suppliedRowKeys: Set<TKey> } | undefined {
    return this.activeHydrationContext
  }

  getHydrationSequence(): number {
    return this.hydrationSequence
  }

  getCurrentTerminalFailure(): { error: unknown } | undefined {
    const failure = this.terminalFailure
    return failure?.lifecycleGeneration === this.lifecycleGeneration
      ? failure
      : undefined
  }

  getLifecycleGeneration(): number {
    return this.lifecycleGeneration
  }

  private throwIfLifecycleReplaced(lifecycleGeneration: number): void {
    if (lifecycleGeneration !== this.lifecycleGeneration) {
      throw new SyncTransactionAbortedError()
    }
  }

  private throwIfTerminal(): void {
    const failure = this.getCurrentTerminalFailure()
    if (failure) throw failure.error
  }

  private markTerminalFailure(
    error: unknown,
    lifecycleGeneration = this.lifecycleGeneration,
  ): unknown {
    if (lifecycleGeneration !== this.lifecycleGeneration) {
      return error
    }

    const existing = this.getCurrentTerminalFailure()
    if (existing) {
      return existing.error
    }

    this.terminalFailure = { lifecycleGeneration, error }
    this.persistedReadiness?.set({ status: `error`, error })
    this.pendingRemoteSubsetEnsures.clear()
    this.queuedTxCommitted.length = 0
    if (this.remoteEnsureRetryTimer !== null) {
      clearTimeout(this.remoteEnsureRetryTimer)
      this.remoteEnsureRetryTimer = null
    }
    this.rejectQueuedHydrationTransactions(error)
    this.reportSyncError(error)
    return error
  }

  isApplyingInternally(): boolean {
    return this.internalApplyDepth > 0
  }

  isScopedRecoveryPending(): boolean {
    return this.scopedRecoveryPending
  }

  hasBoundCollection(): boolean {
    return this.boundCollection !== null
  }

  setCollection(
    collection: Collection<T, TKey, PersistedCollectionUtils>,
    syncControls: SyncControlFns<T, TKey>,
  ): void {
    if (
      (
        collection.config as typeof collection.config & {
          [collectionOptionsClaim]?: unknown
        }
      )[collectionOptionsClaim] !== this.optionsClaim
    ) {
      throw new InvalidPersistedCollectionConfigError(
        `Persisted sync belongs to its options Collection`,
      )
    }
    if (this.boundCollection && this.boundCollection !== collection) {
      throw new InvalidPersistedCollectionConfigError(
        `Persisted options cannot own more than one Collection`,
      )
    }

    const previousCollection = this.collection
    const previousControls = this.syncControls
    this.setSyncControls(syncControls)
    if (this.collection === collection) {
      this.boundCollection ??= collection
      return
    }
    this.collection = collection
    try {
      if (
        !this.persistence.adapter.claimCacheGeneration ||
        this.mode !== `sync-present` ||
        this.syncMode !== `on-demand`
      ) {
        this.attachCoordinatorSubscription()
      }
    } catch (error) {
      this.collection = previousCollection
      this.syncControls = previousControls
      throw error
    }
    this.boundCollection ??= collection
  }

  getLeadershipState(): PersistedCollectionLeadershipState {
    return {
      nodeId: this.persistence.coordinator.getNodeId(),
      isLeader: this.persistence.coordinator.isLeader(this.storageCollectionId),
    }
  }

  private runInHydrationScope<TResult>(
    task: (adapter: HydrationPersistenceAdapter) => Promise<TResult>,
    adapter: HydrationPersistenceAdapter = this.persistence.adapter,
  ): Promise<TResult> {
    if (adapter.runInHydrationScope) {
      return adapter.runInHydrationScope(task)
    }
    return Promise.resolve().then(() => task(adapter))
  }

  async ensureStarted(): Promise<void> {
    this.throwIfTerminal()
    if (this.startPromise) {
      return this.startPromise
    }

    const lifecycleGeneration = this.lifecycleGeneration
    this.startupCacheGenerationRotated = false
    const isRestart = this.hasAttemptedStartup
    this.hasAttemptedStartup = true
    let resolveStartupMetadata!: () => void
    let rejectStartupMetadata!: (error: unknown) => void
    this.startupMetadataPromise = new Promise<void>((resolve, reject) => {
      resolveStartupMetadata = resolve
      rejectStartupMetadata = reject
    })
    void this.startupMetadataPromise.catch(() => undefined)

    this.startPromise = (async () => {
      await this.claimCacheGeneration(lifecycleGeneration)
      if (lifecycleGeneration !== this.lifecycleGeneration) {
        resolveStartupMetadata()
        return
      }
      let metadataExpired = false
      const loadStartupMetadata = async (
        adapter: HydrationPersistenceAdapter,
      ) => {
        if (lifecycleGeneration !== this.lifecycleGeneration) {
          resolveStartupMetadata()
          return false
        }

        try {
          if (
            !(await this.loadStartupMetadataInternal(
              lifecycleGeneration,
              adapter,
            ))
          ) {
            metadataExpired = true
            return false
          }
          return lifecycleGeneration === this.lifecycleGeneration
        } catch (error) {
          // SQLite can reject its second claim check after a startup read
          // entered with a live claim. That old cache cannot authorize source
          // entry; rotate it after the hydration scope releases its scheduler.
          if (this.cacheGenerationClaim && this.hasExpiredCacheClaim()) {
            metadataExpired = true
            return false
          }
          rejectStartupMetadata(error)
          throw error
        }
      }

      let startup:
        | {
            appliedCursor: number | undefined
            indexBootstrapSnapshot: Array<CollectionIndexMetadata>
            completedLocalIndexSignatures: Set<string>
          }
        | undefined
      const scheduleStartupAsOneHydrate =
        this.persistence.adapter.runInHydrationScope !== undefined &&
        (!isRestart ||
          (this.persistence.adapter.isHydrationScopeScheduled?.() ?? true))
      for (;;) {
        metadataExpired = false
        const storageAtAttempt = this.storageCollectionId
        if (scheduleStartupAsOneHydrate) {
          startup = await this.applyMutex.run(async () => {
            const result = await this.runInHydrationScope(async (adapter) => {
              if (!(await loadStartupMetadata(adapter))) return undefined
              return this.startInternal(
                lifecycleGeneration,
                adapter,
                resolveStartupMetadata,
              )
            })
            if (lifecycleGeneration === this.lifecycleGeneration) {
              await this.flushQueuedTxCommittedUnsafe()
            }
            return result
          })
        } else if (this.persistence.adapter.runInHydrationScope) {
          // Preserve the existing unscheduled-adapter lifecycle contract: a
          // replacement upstream may start while stale hydration is settling,
          // so this restart takes no mutex and waits for no scheduler. One
          // scope still marks both startup reads as queued work, which an
          // election term must not run ahead of.
          startup = await this.runInHydrationScope(async (adapter) =>
            (await loadStartupMetadata(adapter))
              ? this.startInternal(
                  lifecycleGeneration,
                  adapter,
                  resolveStartupMetadata,
                )
              : undefined,
          )
          if (startup && lifecycleGeneration === this.lifecycleGeneration) {
            await this.flushQueuedTxCommittedUnsafe()
          }
        } else if (await loadStartupMetadata(this.persistence.adapter)) {
          // An adapter without a hydration scope reads directly.
          startup = await this.startInternal(
            lifecycleGeneration,
            this.persistence.adapter,
            resolveStartupMetadata,
          )
          if (lifecycleGeneration === this.lifecycleGeneration) {
            await this.flushQueuedTxCommittedUnsafe()
          }
        }
        if (
          this.cacheGenerationClaim &&
          this.syncMode === `on-demand` &&
          // Hydration may have changed this through loadStartupMetadata().
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          !metadataExpired
        ) {
          // Source entry must wait until any private rotation started during
          // index bootstrap has settled. The source has no restart capability
          // until its sync callback returns.
          await this.ensureCacheClaimActive()
          metadataExpired = storageAtAttempt !== this.storageCollectionId
        }
        if (!metadataExpired) break
        // A startup read cannot reacquire the claim inside its hydration
        // scope: claim acquisition uses the regular scheduler lane.
        await this.ensureCacheClaimActive()
        if (lifecycleGeneration !== this.lifecycleGeneration) {
          resolveStartupMetadata()
          return
        }
      }
      if (
        this.cacheGenerationClaim &&
        this.syncMode === `on-demand` &&
        lifecycleGeneration === this.lifecycleGeneration
      ) {
        resolveStartupMetadata()
      }
      if (
        startup !== undefined &&
        lifecycleGeneration === this.lifecycleGeneration
      ) {
        await this.requestCoordinatorPersistedIndexes(
          startup.indexBootstrapSnapshot,
          startup.completedLocalIndexSignatures,
        )
        if (
          startup.appliedCursor !== undefined &&
          lifecycleGeneration === this.lifecycleGeneration
        ) {
          await this.waitForAppliedReceiptsAfter(
            startup.appliedCursor,
            `accepted`,
          )
        }
      }
      if (lifecycleGeneration === this.lifecycleGeneration) {
        this.startupSettled = true
        this.persistedReadiness?.set({ status: `ready` })
      }
      resolveStartupMetadata()
    })().catch((error) => {
      rejectStartupMetadata(error)
      throw this.markTerminalFailure(error, lifecycleGeneration)
    })
    void this.startPromise.catch(() => undefined)
    return this.startPromise
  }

  ensureResumeBaselineHydrated(): Promise<void> {
    this.throwIfTerminal()
    if (this.resumeBaselinePromise) {
      return this.resumeBaselinePromise
    }

    const lifecycleGeneration = this.lifecycleGeneration
    this.resumeBaselinePromise = (async () => {
      await this.ensureStarted()
      if (lifecycleGeneration !== this.lifecycleGeneration) return
      if (this.syncMode !== `on-demand`) return
      if (this.scopedRecovery) return

      const appliedCursor = await this.applyMutex.run(async () => {
        const result = await this.runInHydrationScope((adapter) =>
          this.hydrateBaseline(lifecycleGeneration, adapter),
        )
        if (lifecycleGeneration === this.lifecycleGeneration) {
          await this.flushQueuedTxCommittedUnsafe()
        }
        return result
      })
      if (appliedCursor === false) {
        // Rotation needs the apply mutex, so recover only after releasing it.
        await this.ensureCacheClaimActive()
        return
      }
      if (
        appliedCursor !== undefined &&
        lifecycleGeneration === this.lifecycleGeneration
      ) {
        await this.waitForAppliedReceiptsAfter(appliedCursor, `accepted`)
      }
    })().catch((error) => {
      throw this.markTerminalFailure(error, lifecycleGeneration)
    })
    return this.resumeBaselinePromise
  }

  ensureResumeBaselineCertified(): Promise<void> {
    if (this.resumeCertificationPromise) {
      return this.resumeCertificationPromise
    }

    const lifecycleGeneration = this.lifecycleGeneration
    this.resumeCertificationPromise = (async () => {
      await this.ensureStarted()
      if (lifecycleGeneration !== this.lifecycleGeneration) return
      if (this.scopedRecovery) return

      const storageCollectionId = this.storageCollectionId
      const claimId = this.cacheGenerationClaim?.claimId
      const certificationIsCurrent = () =>
        lifecycleGeneration === this.lifecycleGeneration &&
        !this.scopedRecovery &&
        storageCollectionId === this.storageCollectionId &&
        claimId === this.cacheGenerationClaim?.claimId
      let snapshot: Awaited<
        ReturnType<PersistenceAdapter[`loadResumeSnapshot`]>
      >
      try {
        snapshot = await this.persistence.adapter.loadResumeSnapshot(
          this.storageTargetFor(storageCollectionId, claimId),
          {
            requiredIndexSignatures: this.getRequiredIndexSignatures(),
            includeRows: false,
            cacheGenerationClaimId: claimId,
          },
        )
      } catch (error) {
        if (!certificationIsCurrent()) return
        if (!claimId || !this.hasExpiredCacheClaim()) throw error
        await this.ensureCacheClaimActive()
        return
      }
      if (!certificationIsCurrent()) return
      if (claimId && !(await this.renewCacheClaim(this.persistence.adapter))) {
        await this.ensureCacheClaimActive()
        return
      }
      if (!certificationIsCurrent()) return
      this.bindResumeSnapshotEvidence(snapshot)
    })()
    return this.resumeCertificationPromise
  }

  getKeySetEvidence(): PersistedKeySetEvidence | undefined {
    return this.persistedKeySetEvidence
  }

  hasManagedCacheGeneration(): boolean {
    return this.cacheGenerationClaim !== undefined
  }

  hasRotatedStartupCacheGeneration(): boolean {
    return this.startupCacheGenerationRotated
  }

  async startScopedRecovery(resetMetadata?: {
    key: string
    value: unknown
  }): Promise<void> {
    this.throwIfTerminal()
    this.clearCacheClaimRenewal()
    const lifecycleGeneration = this.lifecycleGeneration
    const restartSource = this.restartSourceAfterScopedRecovery
    // Invalidate an in-flight old-cache read before yielding to the mutex.
    this.scopedRecovery = true
    this.scopedRecoveryPending = true
    const recoverySequence = ++this.scopedRecoverySequence
    this.hydratedDemands.clear()
    this.resetSequence++
    let resolveCacheRotated: (() => void) | undefined
    let rejectCacheRotated: ((error: unknown) => void) | undefined
    let sourceRestart: Promise<void> | undefined
    try {
      if (restartSource) {
        const cacheRotated = new Promise<void>((resolve, reject) => {
          resolveCacheRotated = resolve
          rejectCacheRotated = reject
        })
        void cacheRotated.catch(() => undefined)
        // The source must retire old callbacks before this call returns.
        sourceRestart = Promise.resolve(restartSource(cacheRotated))
        void sourceRestart.catch(() => undefined)
      }
      await this.applyMutex.run(async () => {
        this.throwIfLifecycleReplaced(lifecycleGeneration)
        const claim = this.cacheGenerationClaim
        if (claim && this.persistence.adapter.rotateCacheGeneration) {
          const previousStorageId = claim.storageCollectionId
          const rotated = await this.persistence.adapter.rotateCacheGeneration(
            this.collectionId,
            claim.claimId,
            resetMetadata,
            previousStorageId,
          )
          if (lifecycleGeneration !== this.lifecycleGeneration) {
            // Cleanup released the old claim while rotation was in flight.
            // The returned claim belongs to this abandoned recovery too.
            await this.persistence.adapter.releaseCacheGenerationClaim?.(
              rotated.claimId,
            )
            throw new SyncTransactionAbortedError()
          }
          for (const options of this.activeSubsets.values()) {
            // The retired generation has a separate coordinator route. A
            // paused old leader cannot hold up the new cache's demands.
            void this.persistence.coordinator
              .requestReleaseRemoteSubset(
                previousStorageId,
                this.rotatedAcquisitions.get(options) ?? options,
              )
              .catch(() => undefined)
            if (options.signal?.aborted) {
              this.rotatedAcquisitions.delete(options)
              continue
            }
            this.rotatedAcquisitions.set(options, {
              ...options,
              refetch: true,
            })
          }
          this.remoteSubsetOwnerUnsubscribe?.()
          this.remoteSubsetOwnerUnsubscribe = null
          this.coordinatorUnsubscribe?.()
          this.coordinatorUnsubscribe = null
          this.cacheGenerationClaim = rotated
          this.latestTerm = 0
          this.latestSeq = 0
          this.latestRowVersion = 0
          this.publicRowVersion = 0
          this.resetTermFence = undefined
          this.localTerm = 1
          this.localSeq = 0
          this.localRowVersion = 0
          this.queuedTxCommitted.length = 0
          this.persistedResumeGeneration = undefined
          this.persistedKeySetEvidence = { status: `incompatible` }
          this.resumeCertificationPromise = null
          this.resumeGenerationOwner = Symbol(
            `persisted resume generation owner`,
          )
          this.attachCoordinatorSubscription()
          if (this.remoteSubsetOwner) {
            this.registerRemoteSubsetOwner(this.remoteSubsetOwner)
          }
        }
        if (this.syncControls.begin && this.syncControls.commit) {
          const applied = this.withInternalApply(() => {
            this.syncControls.begin?.()
            this.syncControls.truncate?.({ markReady: false })
            if (resetMetadata) {
              this.syncControls.metadata?.collection.set(
                resetMetadata.key,
                resetMetadata.value,
              )
            }
            return this.syncControls.commit?.() ?? true
          })
          await whenSyncAccepted(applied)
          if (
            !this.cacheGenerationClaim &&
            recoverySequence === this.scopedRecoverySequence
          ) {
            this.scopedRecoveryPending = false
          }
          await this.runInHydrationScope(async (adapter) => {
            if (this.recoverQueuedAfterLocalLoadFailure) {
              this.recoverQueuedAfterLocalLoadFailure = false
              await this.recoverBufferedTransactionsAfterLocalLoadFailureUnsafe(
                lifecycleGeneration,
                adapter,
              )
            } else {
              await this.flushQueuedHydrationTransactionsUnsafe(adapter)
            }
          })
          await this.flushQueuedTxCommittedUnsafe()
        }
        if (recoverySequence === this.scopedRecoverySequence) {
          // Older overlapping rotations leave quarantine in place. The final
          // rotation rebuilds the current index registry before releasing the
          // mutex; later index events can then target only its storage ID.
          this.scopedRecoveryPending = false
          if (this.cacheGenerationClaim) {
            const currentIndexes = this.collection?.getIndexMetadata() ?? []
            const completedIndexes = await this.bootstrapPersistedIndexes(
              currentIndexes,
              this.persistence.adapter,
            )
            await this.requestCoordinatorPersistedIndexes(
              currentIndexes,
              completedIndexes,
            )
          }
        }
      })
      this.throwIfLifecycleReplaced(lifecycleGeneration)
      resolveCacheRotated?.()
      await sourceRestart
      if (
        recoverySequence === this.scopedRecoverySequence &&
        this.cacheGenerationClaim
      ) {
        this.scheduleCacheClaimRenewal(this.cacheGenerationClaim)
      }
      // A newer rotation owns reacquisition of the active demands. Dispatching
      // them from this older recovery would fetch against its pending cache.
      if (recoverySequence !== this.scopedRecoverySequence) return
      for (const options of this.activeSubsets.values()) {
        if (options.signal?.aborted) continue
        const rotatedOptions = this.rotatedAcquisitions.get(options)
        if (rotatedOptions) {
          const ensure = this.persistence.coordinator.requestEnsureRemoteSubset(
            this.storageCollectionId,
            rotatedOptions,
          )
          this.rotatedEnsures.set(options, ensure)
          void ensure.catch((error) => this.reportSyncError(error))
        } else {
          this.refreshScopedSubsets()
          break
        }
      }
    } catch (error) {
      rejectCacheRotated?.(error)
      throw this.markTerminalFailure(error, lifecycleGeneration)
    }
  }

  getResumeGenerationOwner(): symbol {
    return this.resumeGenerationOwner
  }

  private async hydrateBaseline(
    lifecycleGeneration: number,
    adapter: HydrationPersistenceAdapter,
  ): Promise<number | undefined | false> {
    if (lifecycleGeneration !== this.lifecycleGeneration) return undefined

    // The baseline shares the unconstrained demand key. Its lease is never
    // released, and every reload rereads it, so that coverage stays valid.
    const baseline = {}
    this.activeSubsets.set(this.getSubsetKey(baseline), baseline)
    const appliedCursor = this.appliedReceiptSequence
    const hydrated = await this.hydrateSubsetUnsafe(
      baseline,
      {
        lifecycleGeneration,
        bindKeySetEvidence: true,
      },
      adapter,
    )
    if (!hydrated) return false
    return lifecycleGeneration === this.lifecycleGeneration
      ? appliedCursor
      : undefined
  }

  async ensureStartupMetadataLoaded(): Promise<void> {
    this.throwIfTerminal()
    if (this.startupMetadataPromise) {
      return this.startupMetadataPromise
    }

    void this.ensureStarted()
    return this.startupMetadataPromise!
  }

  private async startInternal(
    lifecycleGeneration: number,
    adapter: HydrationPersistenceAdapter,
    onStartupMetadataLoaded: () => void,
  ): Promise<
    | {
        appliedCursor: number | undefined
        indexBootstrapSnapshot: Array<CollectionIndexMetadata>
        completedLocalIndexSignatures: Set<string>
      }
    | undefined
  > {
    if (lifecycleGeneration !== this.lifecycleGeneration) return undefined

    const indexBootstrapSnapshot = this.collection?.getIndexMetadata() ?? []
    this.attachIndexLifecycleListeners()
    const completedLocalIndexSignatures = await this.bootstrapPersistedIndexes(
      indexBootstrapSnapshot,
      adapter,
    )
    if (lifecycleGeneration !== this.lifecycleGeneration) return undefined

    // Eager and unmanaged sources start at the hydrate boundary so their first
    // transaction binds to its sequence. A managed on-demand source waits
    // until the scope exits and any concurrent private rotation settles.
    if (!this.cacheGenerationClaim || this.syncMode !== `on-demand`) {
      onStartupMetadataLoaded()
    }
    const appliedCursor =
      this.syncMode !== `on-demand`
        ? await this.hydrateBaseline(lifecycleGeneration, adapter)
        : undefined
    return lifecycleGeneration === this.lifecycleGeneration
      ? {
          appliedCursor: appliedCursor === false ? undefined : appliedCursor,
          indexBootstrapSnapshot,
          completedLocalIndexSignatures,
        }
      : undefined
  }

  private async loadStartupMetadataInternal(
    lifecycleGeneration: number,
    adapter: HydrationPersistenceAdapter,
  ): Promise<boolean> {
    const claimId = this.cacheGenerationClaim?.claimId
    const storageCollectionId = this.storageCollectionId
    const snapshot = await adapter.loadResumeSnapshot(
      this.storageTargetFor(storageCollectionId, claimId),
      {
        includeRows: false,
        cacheGenerationClaimId: claimId,
      },
    )
    if (lifecycleGeneration !== this.lifecycleGeneration) return false
    if (claimId !== this.cacheGenerationClaim?.claimId) return false
    if (storageCollectionId !== this.storageCollectionId) return false
    if (claimId && !(await this.renewCacheClaim(adapter))) return false
    if (lifecycleGeneration !== this.lifecycleGeneration) return false
    if (claimId !== this.cacheGenerationClaim?.claimId) return false
    if (storageCollectionId !== this.storageCollectionId) return false
    this.persistedResumeGeneration = this.getResumeSnapshotGeneration(snapshot)
    this.persistedKeySetEvidence = snapshot.keySet
    this.observeStreamPosition(
      snapshot.latestTerm,
      snapshot.latestSeq,
      snapshot.latestRowVersion,
    )
    const applied = this.replaceCollectionMetadataSnapshot(
      snapshot.collectionMetadata,
    )
    await whenSyncAccepted(applied)
    return true
  }

  private async loadCollectionMetadataSnapshot(
    adapter: HydrationPersistenceAdapter,
  ): Promise<Array<{ key: string; value: unknown }>> {
    if (!adapter.loadCollectionMetadata) {
      return []
    }

    return adapter.loadCollectionMetadata(this.storageTargetFor(), {
      cacheGenerationClaimId: this.cacheGenerationClaim?.claimId,
    })
  }

  private replaceCollectionMetadataSnapshot(
    collectionMetadata: Array<{ key: string; value: unknown }>,
  ): SyncAppliedReceipt {
    if (
      !this.syncControls.begin ||
      !this.syncControls.commit ||
      !this.syncControls.metadata
    ) {
      return true
    }

    return this.withInternalApply(() => {
      this.syncControls.begin?.()
      this.applyCollectionMetadataSnapshot(collectionMetadata)
      return this.syncControls.commit?.() ?? true
    })
  }

  private applyCollectionMetadataSnapshot(
    collectionMetadata: Array<{ key: string; value: unknown }>,
  ): void {
    const metadata = this.syncControls.metadata
    if (!metadata) return
    const next = new Map(
      collectionMetadata.map(({ key, value }) => [key, value]),
    )
    for (const { key } of metadata.collection.list()) {
      if (!next.has(key)) metadata.collection.delete(key)
    }
    for (const [key, value] of next) metadata.collection.set(key, value)
  }

  async loadSubset(
    options: LoadSubsetOptions,
    upstreamLoadSubset?: LoadSubsetFn,
    onHydrationStarted?: () => void,
    isDemandRetained?: () => boolean,
  ): Promise<void> {
    this.throwIfTerminal()
    await this.ensureCacheClaimActive()
    // The caller can retire demand while claim renewal or rotation is awaited.
    // No acquisition may start after that retirement.
    if (options.signal?.aborted || (isDemandRetained && !isDemandRetained()))
      return
    const lifecycleGeneration = this.lifecycleGeneration
    const subsetKey = this.getSubsetKey(options)
    const truncateGeneration = this.sourceTruncateGeneration
    const routeRemoteDemandDuringHydration =
      this.canRouteRemoteDemandThroughCoordinator()
    // Wire admission failures are permanent input errors, not transport retries.
    if (routeRemoteDemandDuringHydration) validateRemoteSubsetOptions(options)
    this.activeSubsets.set(subsetKey, options)
    const appliedCursor = this.appliedReceiptSequence
    try {
      const hydrated = await this.applyMutex.run(
        async (): Promise<boolean | `aborted`> => {
          if (options.signal?.aborted) return `aborted`
          try {
            return await this.runInHydrationScope<boolean | `aborted`>(
              (adapter) => {
                if (options.signal?.aborted) {
                  return Promise.resolve(`aborted`)
                }
                onHydrationStarted?.()
                return this.hydrateSubsetUnsafe(
                  options,
                  {
                    lifecycleGeneration,
                    requestLocalLoadFailure: true,
                    rejectBufferedReplayFailure: true,
                  },
                  adapter,
                )
              },
            )
          } finally {
            if (
              lifecycleGeneration === this.lifecycleGeneration &&
              !this.getCurrentTerminalFailure()
            ) {
              await this.flushQueuedTxCommittedUnsafe()
            }
          }
        },
      )
      if (hydrated === `aborted`) {
        if (this.activeSubsets.get(subsetKey) === options) {
          this.activeSubsets.delete(subsetKey)
        }
        return
      }
      if (!hydrated) {
        // The old cache read is discarded. Recovery reacquires this retained
        // demand under the new storage ID, so await that acquisition rather
        // than starting another source request with old request data.
        await this.ensureCacheClaimActive()
        const rotatedOptions = this.rotatedAcquisitions.get(options)
        if (
          rotatedOptions &&
          this.activeSubsets.get(subsetKey) === options &&
          !options.signal?.aborted
        ) {
          await (this.rotatedEnsures.get(options) ??
            this.persistence.coordinator.requestEnsureRemoteSubset(
              this.storageCollectionId,
              rotatedOptions,
            ))
          await this.applyLeaderCommitsBeforeReply(options)
        }
        return
      }
      if (lifecycleGeneration !== this.lifecycleGeneration) return
      await this.waitForAppliedReceiptsAfter(appliedCursor)
      // Leadership can change while hydration waits. Validate newly remote
      // demand inside the admission cleanup boundary, before retry can own it.
      if (
        !routeRemoteDemandDuringHydration &&
        this.canRouteRemoteDemandThroughCoordinator()
      ) {
        validateRemoteSubsetOptions(options)
      }
    } catch (error) {
      if (this.activeSubsets.get(subsetKey) === options) {
        this.activeSubsets.delete(subsetKey)
      }
      throw error
    }

    if (
      options.signal?.aborted ||
      this.activeSubsets.get(this.getSubsetKey(options)) !== options
    ) {
      if (
        options.signal?.aborted &&
        this.activeSubsets.get(subsetKey) === options
      ) {
        this.activeSubsets.delete(subsetKey)
      }
      return
    }

    if (this.canRouteRemoteDemandThroughCoordinator()) {
      try {
        await this.persistence.coordinator.requestEnsureRemoteSubset(
          this.storageCollectionId,
          this.rotatedAcquisitions.get(options) ?? options,
        )
      } catch (error) {
        if (
          options.signal?.aborted ||
          (typeof error === `object` &&
            error !== null &&
            `name` in error &&
            error.name === `AbortError`)
        ) {
          this.pendingRemoteSubsetEnsures.delete(this.getSubsetKey(options))
          throw error
        }
        this.queueRemoteSubsetEnsure(options)
        throw error
      }
      await this.applyLeaderCommitsBeforeReply(options)
      return
    }

    if (
      truncateGeneration === this.sourceTruncateGeneration &&
      this.activeSubsets.get(subsetKey) === options
    ) {
      this.hydratedDemands.add(getLoadSubsetDemandKey(options))
    }

    if (upstreamLoadSubset) {
      try {
        await upstreamLoadSubset(options)
      } catch (error) {
        this.noteUpstreamLoadFailure(options, error)
        throw error
      }
    }
  }

  loadHydratedSubset(
    options: LoadSubsetOptions,
    upstreamLoadSubset?: LoadSubsetFn,
  ): true | Promise<void> | undefined {
    const failure = this.getCurrentTerminalFailure()
    if (failure) return Promise.reject(failure.error)
    if (
      this.hasExpiredCacheClaim() ||
      !this.startupSettled ||
      this.isHydratingNow() ||
      this.canRouteRemoteDemandThroughCoordinator() ||
      options.refetch === true ||
      !this.hydratedDemands.has(getLoadSubsetDemandKey(options))
    ) {
      return
    }

    this.activeSubsets.set(this.getSubsetKey(options), options)
    let result: true | Promise<void>
    try {
      result = upstreamLoadSubset?.(options) ?? true
    } catch (error) {
      this.noteUpstreamLoadFailure(options, error)
      return Promise.reject(error)
    }
    if (result === true) {
      return true
    }

    return result.then(
      () => {
        this.queueRemoteSubsetEnsure(options)
      },
      (error: unknown) => {
        this.noteUpstreamLoadFailure(options, error)
        throw error
      },
    )
  }

  private noteUpstreamLoadFailure(
    options: LoadSubsetOptions,
    error: unknown,
  ): void {
    if (
      options.signal?.aborted ||
      (typeof error === `object` &&
        error !== null &&
        `name` in error &&
        error.name === `AbortError`)
    ) {
      this.pendingRemoteSubsetEnsures.delete(this.getSubsetKey(options))
      return
    }
    console.warn(`Failed to trigger remote subset load:`, error)
    this.queueRemoteSubsetEnsure(options)
  }

  noteSourceTruncate(): void {
    this.sourceTruncateGeneration++
    this.hydratedDemands.clear()
  }

  unloadSubset(
    options: LoadSubsetOptions,
    upstreamUnloadSubset?: (options: LoadSubsetOptions) => void,
  ): void {
    const subsetKey = this.getSubsetKey(options)
    this.activeSubsets.delete(subsetKey)
    this.pendingRemoteSubsetEnsures.delete(subsetKey)
    const remoteOptions = this.rotatedAcquisitions.get(options) ?? options
    this.rotatedAcquisitions.delete(options)
    const demandKey = getLoadSubsetDemandKey(options)
    const stillActive = Array.from(this.activeSubsets.values()).some(
      (active) => getLoadSubsetDemandKey(active) === demandKey,
    )
    if (!stillActive) this.hydratedDemands.delete(demandKey)
    if (this.mode === `sync-present`) {
      void this.persistence.coordinator
        .requestReleaseRemoteSubset(this.storageCollectionId, remoteOptions)
        .catch((error) => {
          this.reportSyncError(error)
        })
    }
    if (upstreamUnloadSubset) {
      try {
        const result = (
          upstreamUnloadSubset as unknown as (
            options: LoadSubsetOptions,
          ) => unknown
        )(options)
        void Promise.resolve(result).catch((error) => {
          this.reportSyncError(error)
        })
      } catch (error) {
        this.reportSyncError(error)
      }
    }
  }

  async forceReloadSubset(options: LoadSubsetOptions): Promise<void> {
    this.throwIfTerminal()
    await this.ensureCacheClaimActive()
    const lifecycleGeneration = this.lifecycleGeneration
    // A one-shot refresh does not acquire an enduring subscription lease.
    const hydrated = await this.applyMutex.run(async () => {
      const result = await this.runInHydrationScope((adapter) =>
        this.hydrateSubsetUnsafe(
          options,
          {
            lifecycleGeneration,
            rejectBufferedReplayFailure: true,
          },
          adapter,
        ),
      )
      if (lifecycleGeneration === this.lifecycleGeneration) {
        await this.flushQueuedTxCommittedUnsafe()
      }
      return result
    })
    if (!hydrated) await this.ensureCacheClaimActive()
  }

  queueHydrationBufferedTransaction(
    transaction: BufferedSyncTransaction<T, TKey>,
  ): void {
    const failure = this.getCurrentTerminalFailure()
    if (failure) {
      transaction.rejectApplied?.(failure.error)
      return
    }
    transaction.admittedStorageCollectionId = this.storageCollectionId
    this.queuedHydrationTransactions.push(transaction)
  }

  applyHydrationBufferedTransaction(
    transaction: BufferedSyncTransaction<T, TKey>,
  ): Promise<void> {
    const failure = this.getCurrentTerminalFailure()
    if (failure) return Promise.reject(failure.error)
    transaction.admittedStorageCollectionId = this.storageCollectionId
    return this.applyMutex.run(async () => {
      await this.applyBufferedSyncTransactionUnsafe(transaction)
    })
  }

  normalizeSyncWriteMessage(
    message: ChangeMessageOrDeleteKeyMessage<T, TKey>,
  ): SyncWriteNormalization<T, TKey> {
    if (!this.collection) {
      throw new InvalidPersistedCollectionConfigError(
        `collection must be attached before sync writes are processed`,
      )
    }

    if (`key` in message) {
      const key = message.key
      const previousValue = this.collection.get(key) ?? ({} as T)

      return {
        operation: {
          type: `delete`,
          key,
          value: previousValue,
        },
      }
    }

    // Handle delete messages that include the full value instead of just a key
    // (e.g. from queryCollectionOptions which sends { type: 'delete', value: oldItem })
    if (message.type === `delete`) {
      const key = this.collection.getKeyFromItem(message.value)
      const previousValue = this.collection.get(key) ?? message.value

      return {
        operation: {
          type: `delete`,
          key,
          value: previousValue,
        },
      }
    }

    const key = this.collection.getKeyFromItem(message.value)
    return {
      operation: {
        type: `update`,
        key,
        value: message.value,
        metadata: message.metadata,
      },
    }
  }

  async persistAndConfirmCollectionMutations(
    mutations: Array<PendingMutation<T>>,
    lifecycleGeneration = this.lifecycleGeneration,
  ): Promise<void> {
    this.throwIfTerminal()
    this.throwIfLifecycleReplaced(lifecycleGeneration)
    if (mutations.length === 0) {
      return
    }

    try {
      await this.applyMutex.run(async () => {
        // Startup metadata establishes the durable term/sequence boundary. A
        // mutation admitted before it resolves must wait rather than allocate a
        // default position that can collide with an already-applied transaction.
        await this.ensureStartupMetadataLoaded()
        this.throwIfLifecycleReplaced(lifecycleGeneration)
        const acceptedMutationIds = await this.persistCollectionMutationsUnsafe(
          mutations,
          lifecycleGeneration,
        )
        this.throwIfLifecycleReplaced(lifecycleGeneration)
        const acceptedMutationIdSet = new Set(acceptedMutationIds)
        const acceptedMutations = mutations.filter((mutation) =>
          acceptedMutationIdSet.has(mutation.mutationId),
        )

        if (acceptedMutations.length !== mutations.length) {
          throw new Error(
            `persistence coordinator accepted ${acceptedMutations.length} of ${mutations.length} mutations; partial acceptance is not supported`,
          )
        }

        try {
          await this.confirmMutationsSyncUnsafe(acceptedMutations)
        } catch (error) {
          throw this.markTerminalFailure(error, lifecycleGeneration)
        }
      })
    } catch (error) {
      if (error instanceof PersistedCollectionDurabilityError) {
        throw this.markTerminalFailure(error, lifecycleGeneration)
      }
      throw error
    }
  }

  async acceptTransactionMutations(transaction: {
    mutations: Array<PendingMutation<Record<string, unknown>>>
  }): Promise<void> {
    this.throwIfTerminal()
    const collectionMutations = this.filterMutationsForCollection(
      transaction.mutations,
    )

    if (collectionMutations.length === 0) {
      return
    }

    await this.persistAndConfirmCollectionMutations(collectionMutations)
  }

  cleanup(): Promise<void> {
    this.advanceLifecycle()
    const remoteReleases: Array<Promise<void>> = []
    const failures: Array<unknown> = []
    const attempt = (callback: () => void): void => {
      try {
        callback()
      } catch (error) {
        failures.push(error)
      }
    }

    if (this.mode === `sync-present`) {
      for (const options of this.activeSubsets.values()) {
        attempt(() => {
          remoteReleases.push(
            this.persistence.coordinator
              .requestReleaseRemoteSubset(
                this.storageCollectionId,
                this.rotatedAcquisitions.get(options) ?? options,
              )
              .catch((error) => {
                this.reportSyncError(error)
              }),
          )
        })
      }
    }

    attempt(() => this.coordinatorUnsubscribe?.())
    this.coordinatorUnsubscribe = null

    attempt(() => this.remoteSubsetOwnerUnsubscribe?.())
    this.remoteSubsetOwnerUnsubscribe = null
    this.remoteSubsetOwner = undefined

    attempt(() => this.indexAddedUnsubscribe?.())
    this.indexAddedUnsubscribe = null

    attempt(() => this.indexRemovedUnsubscribe?.())
    this.indexRemovedUnsubscribe = null

    if (this.remoteEnsureRetryTimer !== null) {
      clearTimeout(this.remoteEnsureRetryTimer)
      this.remoteEnsureRetryTimer = null
    }

    this.pendingRemoteSubsetEnsures.clear()
    this.rotatedAcquisitions.clear()
    for (const [options, storageId] of this.scopedRefreshes) {
      remoteReleases.push(
        this.persistence.coordinator.requestReleaseRemoteSubset(
          storageId,
          options,
        ),
      )
    }
    this.scopedRefreshes.clear()
    this.activeSubsets.clear()
    this.hydratedDemands.clear()
    for (const transaction of this.queuedHydrationTransactions) {
      transaction.rejectApplied?.(new SyncTransactionAbortedError())
    }
    this.queuedHydrationTransactions.length = 0
    this.queuedTxCommitted.length = 0
    this.clearSyncControls()
    this.collection = null
    const claim = this.cacheGenerationClaim
    this.cacheGenerationClaim = undefined
    this.clearCacheClaimRenewal()
    this.cacheClaimRecovery = null
    if (claim && this.persistence.adapter.releaseCacheGenerationClaim) {
      remoteReleases.push(
        this.persistence.adapter.releaseCacheGenerationClaim(claim.claimId),
      )
    }
    return Promise.all(remoteReleases).then(() => {
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) {
        throw new AggregateError(failures, `Persistence cleanup failed`, {
          cause: failures[0],
        })
      }
    })
  }

  private advanceLifecycle(): void {
    this.lifecycleGeneration++
    this.clearCacheClaimRenewal()
    this.cacheClaimRecovery = null
    this.scopedRecovery = false
    this.scopedRecoveryPending = false
    this.scopedRecoverySequence++
    this.recoverQueuedAfterLocalLoadFailure = false
    this.persistedReadiness?.set({ status: `loading` })
    this.startupSettled = false
    this.publicRowVersion = 0
    this.resetTermFence = undefined
    this.hydratedDemands.clear()
    this.startupMetadataPromise = null
    this.startPromise = null
    this.resumeBaselinePromise = null
    this.terminalFailure = undefined
    this.resumeCertificationPromise = null
    this.persistedKeySetEvidence = undefined
    this.persistedResumeGeneration = undefined
    this.resumeGenerationOwner = Symbol(`persisted resume generation owner`)
  }

  private withInternalApply<TResult>(task: () => TResult): TResult {
    this.internalApplyDepth++
    try {
      return task()
    } finally {
      this.internalApplyDepth--
    }
  }

  private getRequiredIndexSignatures(): ReadonlyArray<string> {
    if (!this.collection) {
      return []
    }

    return this.collection
      .getIndexMetadata()
      .map((metadata) => metadata.signature)
  }

  private loadSubsetRowsUnsafe(
    options: LoadSubsetOptions,
    adapter: HydrationPersistenceAdapter,
  ): Promise<Array<{ key: TKey; value: T; metadata?: unknown }>> {
    if (this.scopedRecovery) return Promise.resolve([])
    return adapter.loadSubset(this.storageTargetFor(), options, {
      requiredIndexSignatures: this.getRequiredIndexSignatures(),
      cacheGenerationClaimId: this.cacheGenerationClaim?.claimId,
    }) as Promise<Array<{ key: TKey; value: T; metadata?: unknown }>>
  }

  private async scanPersistedRowsUnsafe(
    options?: PersistedRowScanOptions,
  ): Promise<Array<PersistedScannedRow<T, TKey>>> {
    if (!this.persistence.adapter.scanRows) {
      return []
    }

    return this.persistence.adapter.scanRows(this.storageTargetFor(), options, {
      cacheGenerationClaimId: this.cacheGenerationClaim?.claimId,
    }) as Promise<Array<PersistedScannedRow<T, TKey>>>
  }

  async scanPersistedRows(
    options?: PersistedRowScanOptions,
  ): Promise<Array<PersistedScannedRow<T, TKey>>> {
    for (;;) {
      this.throwIfTerminal()
      await this.ensureCacheClaimActive()
      const claimId = this.cacheGenerationClaim?.claimId
      const storageCollectionId = this.storageCollectionId
      const rows = await this.applyMutex.run(() =>
        this.scanPersistedRowsUnsafe(options),
      )
      if (this.scopedRecoveryPending) {
        throw new SyncTransactionAbortedError()
      }
      if (
        claimId !== this.cacheGenerationClaim?.claimId ||
        storageCollectionId !== this.storageCollectionId
      ) {
        continue
      }
      if (claimId && !(await this.renewCacheClaim(this.persistence.adapter))) {
        continue
      }
      return rows
    }
  }

  private async hydrateSubsetUnsafe(
    options: LoadSubsetOptions,
    config: {
      lifecycleGeneration: number
      bindKeySetEvidence?: boolean
      requestLocalLoadFailure?: boolean
      rejectBufferedReplayFailure?: boolean
    },
    adapter: HydrationPersistenceAdapter,
  ): Promise<boolean> {
    let rowsLoaded = false
    let boundRowVersion: number | undefined
    let replayFailure: { reason: unknown } | undefined
    const resetSequence = this.resetSequence
    this.hydrationSequence++
    const hydrationContext = { suppliedRowKeys: new Set<TKey>() }
    this.activeHydrationContext = hydrationContext
    try {
      this.throwIfTerminal()
      this.hydratingGeneration = config.lifecycleGeneration
      try {
        let rows: Array<{ key: TKey; value: T; metadata?: unknown }>
        let bindResumeSnapshot: (() => void) | undefined
        if (config.bindKeySetEvidence && !this.scopedRecovery) {
          const snapshot = await adapter.loadResumeSnapshot(
            this.storageTargetFor(),
            {
              requiredIndexSignatures: this.getRequiredIndexSignatures(),
              includeRows: true,
              cacheGenerationClaimId: this.cacheGenerationClaim?.claimId,
            },
          )
          rows = snapshot.rows as Array<{
            key: TKey
            value: T
            metadata?: unknown
          }>
          if (config.lifecycleGeneration !== this.lifecycleGeneration)
            return true
          if (resetSequence !== this.resetSequence) return true
          bindResumeSnapshot = () => this.bindResumeSnapshotEvidence(snapshot)
          boundRowVersion = snapshot.latestRowVersion
        } else {
          rows = await this.loadSubsetRowsUnsafe(options, adapter)
        }
        const complete =
          this.syncMode === `on-demand` &&
          !this.scopedRecovery &&
          options.where === undefined &&
          options.limit === undefined &&
          options.offset === undefined &&
          options.cursor === undefined
        const validationRows = complete ? rows : undefined
        rowsLoaded = true
        if (config.lifecycleGeneration !== this.lifecycleGeneration) return true
        if (resetSequence !== this.resetSequence) return true

        // SQLite validated the claim at read admission. A paused sync run
        // can resume after expiry before its renewal timer runs, so cached
        // rows need fresh authority before they enter the public Collection.
        if (
          this.cacheGenerationClaim &&
          !(await this.renewCacheClaim(adapter))
        ) {
          return false
        }
        if (config.lifecycleGeneration !== this.lifecycleGeneration) return true
        if (resetSequence !== this.resetSequence) return true
        bindResumeSnapshot?.()

        if (
          !config.bindKeySetEvidence ||
          this.persistedKeySetEvidence?.status !== `incompatible`
        ) {
          for (const row of rows) {
            hydrationContext.suppliedRowKeys.add(row.key)
          }
          const applied = this.applyRowsToCollection(rows, validationRows)
          await whenSyncAccepted(applied)
          if (boundRowVersion !== undefined) {
            this.publicRowVersion = Math.max(
              this.publicRowVersion,
              boundRowVersion,
            )
          }
        }
      } finally {
        if (
          this.activeHydrationContext === hydrationContext &&
          this.hydratingGeneration === config.lifecycleGeneration
        ) {
          this.hydratingGeneration = null
        }
      }

      if (config.lifecycleGeneration !== this.lifecycleGeneration) return true
      if (!this.scopedRecoveryPending) {
        replayFailure =
          await this.flushQueuedHydrationTransactionsUnsafe(adapter)
      }
      if (config.lifecycleGeneration !== this.lifecycleGeneration) return true
    } catch (error) {
      // A read admitted under a live claim may fail at the adapter's later
      // claim check after this run wakes from expiry. Its old cache has no
      // authority; the retained demand must reacquire under a new generation.
      if (
        config.requestLocalLoadFailure &&
        !rowsLoaded &&
        this.cacheGenerationClaim &&
        this.hasExpiredCacheClaim()
      ) {
        return false
      }
      if (config.requestLocalLoadFailure && !rowsLoaded) {
        if (this.scopedRecoveryPending) {
          this.recoverQueuedAfterLocalLoadFailure = true
          throw error
        }
        // Keep admitting source work to the hydration queue while recovery
        // reconstructs any persisted baseline required by partial updates.
        // The failed subset itself owns no rows, so recovery must evaluate
        // each queued transaction against the durable snapshot at its exact
        // FIFO cut instead of treating the snapshot as a successful load.
        this.hydratingGeneration = config.lifecycleGeneration
        try {
          await this.recoverBufferedTransactionsAfterLocalLoadFailureUnsafe(
            config.lifecycleGeneration,
            adapter,
          )
        } catch (baselineError) {
          const terminalError = this.markTerminalFailure(
            baselineError,
            config.lifecycleGeneration,
          )
          throw terminalError
        } finally {
          if (this.hydratingGeneration === config.lifecycleGeneration) {
            this.hydratingGeneration = null
          }
        }
        throw error
      }
      throw this.markTerminalFailure(error, config.lifecycleGeneration)
    } finally {
      if (this.activeHydrationContext === hydrationContext) {
        this.activeHydrationContext = undefined
      }
    }
    if (replayFailure && config.rejectBufferedReplayFailure) {
      throw replayFailure.reason
    }
    return true
  }

  private async recoverBufferedTransactionsAfterLocalLoadFailureUnsafe(
    lifecycleGeneration: number,
    adapter: HydrationPersistenceAdapter,
  ): Promise<void> {
    let snapshotRows:
      Map<TKey, { key: TKey; value: T; metadata?: unknown }> | undefined
    type RecoveryPresence = `present` | `absent` | `unknown`
    const recoveredPresence = new Map<TKey, RecoveryPresence>()
    let snapshotInvalidatedByTruncate = false

    while (this.queuedHydrationTransactions.length > 0) {
      const transaction = this.queuedHydrationTransactions.shift()
      if (!transaction) continue

      try {
        this.throwIfLifecycleReplaced(lifecycleGeneration)
        const baselineRows = new Map<
          TKey,
          { key: TKey; value: T; metadata?: unknown }
        >()
        const transactionPresence = new Map<TKey, RecoveryPresence>()
        const transactionStartsWithTruncate = transaction.truncate
        const getPresence = (key: TKey): RecoveryPresence => {
          const known = transactionPresence.get(key)
          if (known !== undefined) return known
          if (transactionStartsWithTruncate) {
            transactionPresence.set(key, `absent`)
            return `absent`
          }
          const recovered = recoveredPresence.get(key)
          if (recovered !== undefined) {
            transactionPresence.set(key, recovered)
            return recovered
          }
          const present =
            this.collection?._hasHydratedKey(key) === true
              ? `present`
              : snapshotInvalidatedByTruncate
                ? `absent`
                : `unknown`
          transactionPresence.set(key, present)
          return present
        }

        if (!transaction.signal?.aborted) {
          for (const [index, operation] of transaction.operations.entries()) {
            const key = operation.key
            if (
              operation.type === `update` &&
              transaction.partialUpdateOperationIndexes.has(index) &&
              getPresence(key) === `unknown`
            ) {
              if (snapshotRows === undefined) {
                const snapshot = this.scopedRecovery
                  ? undefined
                  : await adapter.loadResumeSnapshot(this.storageTargetFor(), {
                      requiredIndexSignatures:
                        this.getRequiredIndexSignatures(),
                      includeRows: true,
                      cacheGenerationClaimId:
                        this.cacheGenerationClaim?.claimId,
                    })
                this.throwIfLifecycleReplaced(lifecycleGeneration)
                if (transaction.signal?.aborted) break
                const rows =
                  snapshot && !this.scopedRecovery
                    ? (snapshot.rows as Array<{
                        key: TKey
                        value: T
                        metadata?: unknown
                      }>)
                    : []
                snapshotRows = new Map(rows.map((row) => [row.key, row]))
              }
              const baseline = snapshotRows.get(key)
              if (baseline === undefined) {
                transactionPresence.set(key, `absent`)
              } else {
                baselineRows.set(key, baseline)
                transactionPresence.set(key, `present`)
              }
            }

            transactionPresence.set(
              key,
              operation.type === `delete` ? `absent` : `present`,
            )
          }

          if (baselineRows.size > 0) {
            // Fold the durable baseline into the dependent reservation. It
            // must never become a separately observable publication: the
            // partial source value and its unseen fields are one atomic row.
            if (!transaction.signal?.aborted) {
              transaction.prependHydrationRows([...baselineRows.values()])
            }
          }
        }

        const transactionOutcome =
          await this.applyBufferedSyncTransactionUnsafe(transaction, adapter)
        if (transactionOutcome.applied) {
          if (transaction.truncate) {
            snapshotInvalidatedByTruncate = true
            recoveredPresence.clear()
          }
          for (const operation of transaction.operations) {
            recoveredPresence.set(
              operation.key,
              operation.type === `delete` ? `absent` : `present`,
            )
          }
        }
      } catch (error) {
        transaction.rejectApplied?.(error)
        for (const abandoned of this.queuedHydrationTransactions) {
          abandoned.rejectApplied?.(error)
        }
        this.queuedHydrationTransactions.length = 0
        throw error
      }
    }
  }

  private rejectQueuedHydrationTransactions(error: unknown): void {
    for (const transaction of this.queuedHydrationTransactions) {
      transaction.rejectApplied?.(error)
    }
    this.queuedHydrationTransactions.length = 0
  }

  private applyRowsToCollection(
    rows: Array<{ key: TKey; value: T; metadata?: unknown }>,
    validationRows?: Array<{ key: TKey; value: T; metadata?: unknown }>,
    collectionMetadata?: Array<{ key: string; value: unknown }>,
  ): SyncAppliedReceipt {
    if (
      !this.syncControls.begin ||
      !this.syncControls.write ||
      !this.syncControls.commit
    ) {
      return true
    }

    return this.withInternalApply(() => {
      this.syncControls.begin?.()

      // A full durable snapshot validates already public keys. Only the
      // requested subset may add keys to the public Collection.
      if (validationRows) {
        const durableRows = new Map(validationRows.map((row) => [row.key, row]))
        for (const key of this.collection?.base.keys() ?? []) {
          if (this.collection?._hasHydratedKey(key)) continue
          const durable = durableRows.get(key)
          if (!durable) {
            this.syncControls.write?.({ type: `delete`, key })
          } else {
            const valueChanged = !equalPersistedSnapshotValues(
              this.collection?.base.get(key),
              durable.value,
            )
            const metadataChanged = !equalPersistedSnapshotValues(
              this.syncControls.metadata?.row.get(key),
              durable.metadata,
            )
            if (
              valueChanged ||
              (metadataChanged && durable.metadata !== undefined)
            ) {
              // A persisted read supplies a complete row. In partial-update
              // mode, deleting it within this sync transaction removes fields
              // that are absent from the durable value before replacement.
              if (valueChanged) {
                this.syncControls.write?.({ type: `delete`, key })
              }
              this.syncControls.write?.({
                type: `update`,
                value: durable.value,
                metadata: durable.metadata as
                  Record<string, unknown> | undefined,
              })
            }
            if (metadataChanged && durable.metadata === undefined) {
              this.syncControls.metadata?.row.delete(key)
            }
          }
        }
        for (const key of this.collection?._syncedRowMetadataKeysOutsideBase() ??
          []) {
          this.syncControls.metadata?.row.delete(key)
        }
      }

      for (const row of rows) {
        if (
          (validationRows && this.collection?.base.has(row.key)) ||
          this.collection?._hasHydratedKey(row.key)
        ) {
          continue
        }
        if (
          this.collection?.base.has(row.key) &&
          !equalPersistedSnapshotValues(
            this.collection.base.get(row.key),
            row.value,
          )
        ) {
          this.syncControls.write?.({ type: `delete`, key: row.key })
        }
        this.syncControls.write?.({
          type: `update`,
          value: row.value,
          metadata: row.metadata as Record<string, unknown> | undefined,
        })
      }

      if (collectionMetadata)
        this.applyCollectionMetadataSnapshot(collectionMetadata)

      return this.syncControls.commit?.() ?? true
    })
  }

  private getResumeSnapshotGeneration(snapshot: {
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
    resetEpoch: number
  }): PersistedResumeGeneration {
    return {
      latestTerm: snapshot.latestTerm,
      latestSeq: snapshot.latestSeq,
      latestRowVersion: snapshot.latestRowVersion,
      resetEpoch: snapshot.resetEpoch,
    }
  }

  private isExpectedResumeGeneration(
    generation: PersistedResumeGeneration,
  ): boolean {
    const expected = this.persistedResumeGeneration
    return (
      expected !== undefined &&
      expected.latestRowVersion === generation.latestRowVersion &&
      expected.resetEpoch === generation.resetEpoch &&
      ((expected.latestTerm === generation.latestTerm &&
        expected.latestSeq === generation.latestSeq) ||
        // A no-write election reserves a new term at sequence zero. It does
        // not change the persisted rows or the source resume cursor.
        (generation.latestTerm > expected.latestTerm &&
          generation.latestSeq === 0))
    )
  }

  private bindResumeSnapshotEvidence(snapshot: {
    keySet?: PersistedKeySetEvidence
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
    resetEpoch: number
  }): void {
    const generation = this.getResumeSnapshotGeneration(snapshot)
    const previousEvidenceStatus = this.persistedKeySetEvidence?.status
    // An uncertified sync baseline never authorized a persisted resume cursor,
    // so a later atomic snapshot may replace its evidence while the source
    // performs the already-required fresh snapshot. Local-only collections
    // have no remote cursor to fence; a managed write may advance a still-
    // consistent SQLite baseline during startup. Incompatible evidence remains
    // fail-closed in both modes.
    const mayAcceptUnownedGeneration =
      (this.mode === `sync-present` &&
        previousEvidenceStatus !== `consistent` &&
        previousEvidenceStatus !== `incompatible`) ||
      (this.mode === `sync-absent` &&
        previousEvidenceStatus === `consistent` &&
        snapshot.keySet?.status === `consistent`)
    this.observeStreamPosition(
      snapshot.latestTerm,
      snapshot.latestSeq,
      snapshot.latestRowVersion,
    )
    this.persistedKeySetEvidence =
      this.isExpectedResumeGeneration(generation) || mayAcceptUnownedGeneration
        ? snapshot.keySet
        : { status: `incompatible` }
  }

  private replaceCollectionSnapshot(
    rows: Array<{ key: TKey; value: T; metadata?: unknown }>,
    collectionMetadata: Array<{ key: string; value: unknown }>,
    replayDemand: boolean,
  ): SyncAppliedReceipt {
    if (
      !this.syncControls.begin ||
      !this.syncControls.write ||
      !this.syncControls.commit ||
      !this.syncControls.metadata
    ) {
      return true
    }

    const base = this.collection?.base
    const hydratedKeys = new Set(
      Array.from(base?.keys() ?? []).filter(
        (key) => this.collection?._hasHydratedKey(key) === true,
      ),
    )
    const rowKeys = new Set(rows.map((row) => row.key))
    // A truncate replays the Collection's demand. A follower routes that
    // demand to its leader, whose source loads and commits again, so a
    // follower replaces its rows in place, except after a reset, which owes
    // the replay.
    const followsLeader =
      this.canRouteRemoteDemandThroughCoordinator() &&
      !this.persistence.coordinator.isLeader(this.storageCollectionId)
    const truncate = hydratedKeys.size === 0 && (replayDemand || !followsLeader)

    return this.withInternalApply(() => {
      this.syncControls.begin?.()
      if (truncate) {
        this.syncControls.truncate?.()
      } else {
        for (const key of base?.keys() ?? []) {
          if (!hydratedKeys.has(key) && !rowKeys.has(key)) {
            this.syncControls.write?.({ type: `delete`, key })
          }
        }
        for (const key of this.collection?._syncedRowMetadataKeysOutsideBase() ??
          []) {
          this.syncControls.metadata?.row.delete(key)
        }
      }

      for (const row of rows) {
        if (hydratedKeys.has(row.key)) continue
        if (!truncate && base?.has(row.key)) {
          // Remove stale fields before applying a complete persisted row in
          // the default partial-update mode, without truncating seed keys.
          this.syncControls.write?.({ type: `delete`, key: row.key })
        }
        this.syncControls.write?.({
          type: `update`,
          value: row.value,
          metadata: row.metadata as Record<string, unknown> | undefined,
        })
      }

      this.applyCollectionMetadataSnapshot(collectionMetadata)
      return this.syncControls.commit?.() ?? true
    })
  }

  private matchesCollectionSnapshot(
    rows: Map<TKey, { value: T; metadata?: unknown }>,
    collectionMetadata: Array<{ key: string; value: unknown }>,
  ): boolean {
    if (!this.collection || !this.syncControls.metadata) return false
    const base = this.collection.base
    if (base.size !== rows.size) return false
    for (const [key, row] of rows) {
      if (
        !base.has(key) ||
        !equalPersistedSnapshotValues(base.get(key), row.value) ||
        !equalPersistedSnapshotValues(
          this.syncControls.metadata.row.get(key),
          row.metadata,
        )
      ) {
        return false
      }
    }
    const currentMetadata = this.syncControls.metadata.collection.list()
    if (currentMetadata.length !== collectionMetadata.length) return false
    const expectedMetadata = new Map(
      collectionMetadata.map(({ key, value }) => [key, value]),
    )
    return currentMetadata.every(
      ({ key, value }) =>
        expectedMetadata.has(key) &&
        equalPersistedSnapshotValues(expectedMetadata.get(key), value),
    )
  }

  private async flushQueuedHydrationTransactionsUnsafe(
    adapter: HydrationPersistenceAdapter,
  ): Promise<{ reason: unknown } | undefined> {
    let operationFailure: { reason: unknown } | undefined
    while (this.queuedHydrationTransactions.length > 0) {
      const transaction = this.queuedHydrationTransactions.shift()
      if (!transaction) {
        continue
      }
      try {
        const outcome = await this.applyBufferedSyncTransactionUnsafe(
          transaction,
          adapter,
        )
        operationFailure ??= outcome.hydrationFailure
      } catch (error) {
        transaction.rejectApplied?.(error)
        for (const abandoned of this.queuedHydrationTransactions) {
          abandoned.rejectApplied?.(error)
        }
        this.queuedHydrationTransactions.length = 0
        throw error
      }
    }
    return operationFailure
  }

  private async applyBufferedSyncTransactionUnsafe(
    transaction: BufferedSyncTransaction<T, TKey>,
    scopedAdapter?: HydrationPersistenceAdapter,
  ): Promise<{
    applied: boolean
    hydrationFailure?: { reason: unknown }
  }> {
    this.throwIfTerminal()
    this.throwIfLifecycleReplaced(transaction.lifecycleGeneration)
    if (
      transaction.admittedStorageCollectionId !== undefined &&
      transaction.admittedStorageCollectionId !== this.storageCollectionId
    ) {
      const error = new SyncTransactionAbortedError()
      if (!transaction.rejectApplied) throw error
      transaction.rejectApplied(error)
      return { applied: false }
    }
    if (!transaction.internal && this.scopedRecoveryPending) {
      const error = new SyncTransactionAbortedError()
      if (!transaction.rejectApplied) throw error
      transaction.rejectApplied(error)
      return { applied: false }
    }
    if (
      !transaction.internal &&
      this.cacheGenerationClaim &&
      (scopedAdapter ?? this.persistence.adapter).renewCacheGenerationClaim &&
      !(await this.renewCacheClaim(scopedAdapter ?? this.persistence.adapter))
    ) {
      const error = new SyncTransactionAbortedError()
      // Recovery needs this apply mutex, so start it after the rejected
      // transaction has released its turn. Its new source snapshots use a
      // fresh cache generation; this commit must never be replayed into it.
      queueMicrotask(() => {
        if (transaction.lifecycleGeneration !== this.lifecycleGeneration) return
        if (this.scopedRecoveryPending) return
        void this.startScopedRecovery().catch((failure) => {
          this.markTerminalFailure(failure, transaction.lifecycleGeneration)
        })
      })
      if (!transaction.rejectApplied) throw error
      transaction.rejectApplied(error)
      return { applied: false }
    }
    const abortedBeforeApplication = transaction.signal?.aborted === true
    let abortedDuringApplication = false
    let applicationReturned = false

    try {
      const applied = transaction.internal
        ? this.withInternalApply(transaction.applyToCollection)
        : transaction.applyToCollection()
      applicationReturned = true
      abortedDuringApplication = transaction.signal?.aborted === true
      // Inside the apply mutex, internal work waits only for acceptance: a
      // local mutation's handler may need this mutex, and the rows publish
      // when that mutation settles. A source transaction is stored once it is
      // visible, except one held by a persisting optimistic transaction,
      // which is stored now so a handler can await its acceptance.
      if (transaction.internal) await whenSyncAccepted(applied)
      else if (
        applied !== true &&
        !this.collection?._state.hasPersistingTransaction()
      )
        await applied
      this.throwIfLifecycleReplaced(transaction.lifecycleGeneration)

      if (!transaction.internal) {
        await this.persistAndBroadcastExternalSyncTransactionUnsafe(
          transaction,
          scopedAdapter,
        )
      }
      transaction.resolveApplied?.()
      return { applied: true }
    } catch (error) {
      if (!applicationReturned) {
        abortedDuringApplication = transaction.signal?.aborted === true
      }
      const aborted =
        transaction.signal?.aborted ||
        error instanceof SyncTransactionAbortedError
      const shouldFailStop =
        aborted && transaction.shouldFailStopOnAbort?.() === true
      const terminalError = this.classifyBufferedTransactionFailure(
        transaction,
        error,
      )
      transaction.rejectApplied?.(terminalError)
      if (aborted && !shouldFailStop && transaction.rejectApplied) {
        return {
          applied: false,
          hydrationFailure:
            !abortedBeforeApplication && abortedDuringApplication
              ? { reason: terminalError }
              : undefined,
        }
      }
      throw terminalError
    }
  }

  private classifyBufferedTransactionFailure(
    transaction: BufferedSyncTransaction<T, TKey>,
    error: unknown,
  ): unknown {
    if (error instanceof PersistedCollectionDurabilityError) {
      return this.markTerminalFailure(error, transaction.lifecycleGeneration)
    }
    const aborted =
      transaction.signal?.aborted ||
      error instanceof SyncTransactionAbortedError
    if (aborted && transaction.shouldFailStopOnAbort?.() !== true) {
      return error
    }
    return this.markTerminalFailure(error, transaction.lifecycleGeneration)
  }

  private async persistAndBroadcastExternalSyncTransactionUnsafe(
    transaction: BufferedSyncTransaction<T, TKey>,
    scopedAdapter?: HydrationPersistenceAdapter,
  ): Promise<void> {
    if (transaction.internal) {
      return
    }

    this.throwIfLifecycleReplaced(transaction.lifecycleGeneration)
    if (
      !transaction.truncate &&
      transaction.operations.length === 0 &&
      transaction.rowMetadataWrites.size === 0 &&
      transaction.collectionMetadataWrites.size === 0
    ) {
      return
    }

    const anchor = this.persistedResumeGeneration && {
      latestRowVersion: this.latestRowVersion,
      resetEpoch: this.persistedResumeGeneration.resetEpoch,
    }
    const streamPosition = this.nextLocalStreamPosition()
    const tx = this.createPersistedTxFromOperations(transaction, streamPosition)
    const storageCollectionId = this.storageCollectionId
    let response: ApplyCommittedTxResponse
    try {
      response = await this.persistence.coordinator.requestApplyCommittedTx(
        storageCollectionId,
        tx,
        // A hydration-scoped adapter is already inside the shared scheduler.
        // Ordinary source commits enter it before taking the writer lock.
        scopedAdapter,
      )
    } catch (error) {
      if (
        !(error instanceof IndeterminateCommitError) ||
        !anchor ||
        !this.persistence.coordinator.reconcileCommittedTx
      ) {
        throw error
      }
      let reconciled: ReconcileCommittedTxResponse
      try {
        reconciled = await this.persistence.coordinator.reconcileCommittedTx(
          storageCollectionId,
          tx,
          anchor,
          scopedAdapter,
        )
      } catch (reconcileError) {
        if (reconcileError instanceof PersistedCollectionDurabilityError) {
          throw reconcileError
        }
        throw error
      }
      if (!reconciled.ok) {
        if (reconciled.code === `PERSISTENCE_ERROR`) {
          throw new PersistedCollectionDurabilityError(
            `Failed to reconcile collection "${this.collectionId}": ${reconciled.error}`,
            {
              cause: reconciled,
              code: reconciled.sourceCode ?? reconciled.code,
              path: reconciled.path,
            },
          )
        }
        throw error
      }
      this.recordDurableSourceCommit(transaction, reconciled.committed)
      return
    }
    if (!response.ok) {
      if (response.code === `PERSISTENCE_ERROR`) {
        const error = new PersistedCollectionDurabilityError(
          `Failed to durably persist collection "${this.collectionId}": ${response.error}`,
          {
            cause: response,
            code: response.sourceCode ?? response.code,
            path: response.path,
          },
        )
        throw error
      }
      throw new Error(
        `failed to apply external sync transaction through coordinator: ${response.error}`,
      )
    }
    this.recordDurableSourceCommit(transaction, {
      term: response.term,
      seq: response.seq,
      rowVersion: response.latestRowVersion,
    })
  }

  private recordDurableSourceCommit(
    transaction: BufferedSyncTransaction<T, TKey>,
    position: { term: number; seq: number; rowVersion: number },
  ): void {
    if (transaction.lifecycleGeneration !== this.lifecycleGeneration) return
    this.observeStreamPosition(position.term, position.seq, position.rowVersion)
    if (position.rowVersion === this.publicRowVersion + 1) {
      this.publicRowVersion = position.rowVersion
    }
    if (
      transaction.expectedResumeGenerationOwner ===
        this.resumeGenerationOwner &&
      this.persistedResumeGeneration !== undefined
    ) {
      this.persistedResumeGeneration = {
        ...this.persistedResumeGeneration,
        latestTerm: position.term,
        latestSeq: position.seq,
        latestRowVersion: position.rowVersion,
      }
    }
  }

  private async applyCommittedTx(
    tx: PersistedTx,
    lifecycleGeneration: number,
  ): Promise<void> {
    this.throwIfTerminal()
    this.throwIfLifecycleReplaced(lifecycleGeneration)
    try {
      await this.persistence.adapter.applyCommittedTx(
        this.storageTargetFor(),
        tx,
      )
    } catch (error) {
      throw this.markTerminalFailure(
        toPersistedCollectionDurabilityError(this.collectionId, error),
        lifecycleGeneration,
      )
    }
    this.throwIfLifecycleReplaced(lifecycleGeneration)
  }

  private createPersistedTxFromOperations(
    transaction: BufferedSyncTransaction<T, TKey>,
    streamPosition: { term: number; seq: number; rowVersion: number },
  ): PersistedTx {
    return {
      txId: safeRandomUUID(),
      term: streamPosition.term,
      seq: streamPosition.seq,
      rowVersion: streamPosition.rowVersion,
      cacheGenerationClaimId: this.cacheGenerationClaim?.claimId,
      truncate: transaction.truncate,
      mutations: transaction.operations.map((operation) =>
        operation.type === `update`
          ? {
              type: `update` as const,
              key: operation.key,
              value: operation.value as Record<string, unknown>,
            }
          : {
              type: `delete` as const,
              key: operation.key,
              value: operation.value as Record<string, unknown>,
            },
      ),
      rowMetadataMutations: toMetadataMutations(transaction.rowMetadataWrites),
      collectionMetadataMutations: toMetadataMutations(
        transaction.collectionMetadataWrites,
      ),
    }
  }

  private createPersistedTxFromMutations(
    mutations: Array<PendingMutation<T>>,
    streamPosition: { term: number; seq: number; rowVersion: number },
  ): PersistedTx {
    return {
      txId: safeRandomUUID(),
      term: streamPosition.term,
      seq: streamPosition.seq,
      rowVersion: streamPosition.rowVersion,
      cacheGenerationClaimId: this.cacheGenerationClaim?.claimId,
      mutations: mutations.map((mutation) => {
        if (mutation.type === `delete`) {
          return {
            type: `delete` as const,
            key: mutation.key as string | number,
            value: mutation.original as Record<string, unknown>,
          }
        }

        if (mutation.type === `insert`) {
          return {
            type: `insert` as const,
            key: mutation.key as string | number,
            value: mutation.modified as Record<string, unknown>,
          }
        }

        return {
          type: `update` as const,
          key: mutation.key as string | number,
          value: mutation.modified as Record<string, unknown>,
        }
      }),
    }
  }

  private async confirmMutationsSyncUnsafe(
    mutations: Array<PendingMutation<T>>,
  ): Promise<void> {
    if (
      !this.syncControls.begin ||
      !this.syncControls.write ||
      !this.syncControls.commit
    ) {
      return
    }

    const applied = this.withInternalApply(() => {
      this.syncControls.begin?.()

      for (const mutation of mutations) {
        if (mutation.type === `delete`) {
          this.syncControls.write?.({
            type: `delete`,
            key: mutation.key as TKey,
          })
        } else {
          this.syncControls.write?.({
            type: `update`,
            value: mutation.modified,
          })
        }
      }

      return this.syncControls.commit?.() ?? true
    })

    // The mutation handler awaits this confirmation, so wait only for
    // acceptance: the rows become visible when the mutation settles.
    const accepted = whenSyncAccepted(applied)
    if (accepted !== true) await accepted
  }

  private filterMutationsForCollection(
    mutations: Array<PendingMutation<Record<string, unknown>>>,
  ): Array<PendingMutation<T>> {
    const collection = this.collection
    return mutations.filter((mutation) => {
      if (collection) {
        return mutation.collection === collection
      }
      return mutation.collection.id === this.collectionId
    }) as Array<PendingMutation<T>>
  }

  private async persistCollectionMutationsUnsafe(
    mutations: Array<PendingMutation<T>>,
    lifecycleGeneration: number,
  ): Promise<Array<string>> {
    this.throwIfLifecycleReplaced(lifecycleGeneration)
    // When a coordinator with requestApplyLocalMutations is available, always
    // route through it — even on the leader tab. This ensures the coordinator's
    // seq/rowVersion counters stay in sync with actual writes. Without this,
    // the leader's direct-path writes would increment the runtime's localSeq
    // but leave the coordinator's state.latestSeq stale, causing seq collisions
    // when follower RPCs later arrive.
    if (this.persistence.coordinator.requestApplyLocalMutations) {
      const target = this.storageTargetFor()
      const envelopeMutations = mutations.map((mutation) =>
        toPersistedMutationEnvelope(
          mutation as unknown as PendingMutation<Record<string, unknown>>,
        ),
      )

      const response =
        await this.persistence.coordinator.requestApplyLocalMutations(
          this.storageCollectionId,
          envelopeMutations,
          target.kind === `managed` ? target.claimId : undefined,
        )

      this.throwIfLifecycleReplaced(lifecycleGeneration)

      if (!response.ok) {
        if (response.code === `PERSISTENCE_ERROR`) {
          const error = new PersistedCollectionDurabilityError(
            `Failed to durably persist collection "${this.collectionId}": ${response.error}`,
            {
              cause: response,
              code: response.sourceCode ?? response.code,
              path: response.path,
            },
          )
          throw error
        }
        throw new Error(
          `failed to apply local mutations through coordinator: ${response.error}`,
        )
      }

      // The commit's own tx:committed notice advances the observed position.
      // Observing it here first would make that notice look like a gap.
      const uniqueAcceptedMutationIds = Array.from(
        new Set(response.acceptedMutationIds),
      )
      const submittedMutationIds = new Set(
        mutations.map((mutation) => mutation.mutationId),
      )
      const hasUnknownAcceptedMutationId = uniqueAcceptedMutationIds.some(
        (mutationId) => !submittedMutationIds.has(mutationId),
      )

      if (hasUnknownAcceptedMutationId) {
        throw new Error(
          `persistence coordinator returned unknown mutation ids in applyLocalMutations response`,
        )
      }

      return uniqueAcceptedMutationIds
    }

    // Fallback: no coordinator with requestApplyLocalMutations (e.g.
    // SingleProcessCoordinator). Apply directly and broadcast.
    const streamPosition = this.nextLocalStreamPosition()
    const tx = this.createPersistedTxFromMutations(mutations, streamPosition)
    await this.applyCommittedTx(tx, lifecycleGeneration)

    this.throwIfLifecycleReplaced(lifecycleGeneration)

    this.publishTxCommittedEvent(
      this.createTxCommittedPayload({
        term: tx.term,
        seq: tx.seq,
        txId: tx.txId,
        latestRowVersion: tx.rowVersion,
        changedRows: mutations
          .filter((mutation) => mutation.type !== `delete`)
          .map((mutation) => ({
            key: mutation.key as string | number,
            value: mutation.modified as Record<string, unknown>,
          })),
        deletedKeys: mutations
          .filter((mutation) => mutation.type === `delete`)
          .map((mutation) => mutation.key as string | number),
        rowMetadataMutations: tx.rowMetadataMutations,
        collectionMetadataMutations: tx.collectionMetadataMutations,
      }),
    )

    return mutations.map((mutation) => mutation.mutationId)
  }

  private createTxCommittedPayload(args: {
    term: number
    seq: number
    txId: string
    latestRowVersion: number
    changedRows: Array<{ key: string | number; value: Record<string, unknown> }>
    deletedKeys: Array<string | number>
    rowMetadataMutations?: Array<PersistedRowMetadataMutation>
    collectionMetadataMutations?: Array<PersistedCollectionMetadataMutation>
    hasMetadataChanges?: boolean
    requiresFullReload?: boolean
  }): TxCommitted {
    const rowMetadataMutations = args.rowMetadataMutations ?? []
    const collectionMetadataMutations = args.collectionMetadataMutations ?? []
    const requiresFullReload =
      args.requiresFullReload === true ||
      args.changedRows.length +
        args.deletedKeys.length +
        rowMetadataMutations.length +
        collectionMetadataMutations.length >
        TARGETED_INVALIDATION_KEY_LIMIT

    if (requiresFullReload) {
      return {
        type: `tx:committed`,
        term: args.term,
        seq: args.seq,
        txId: args.txId,
        latestRowVersion: args.latestRowVersion,
        requiresFullReload: true,
      }
    }

    return {
      type: `tx:committed`,
      term: args.term,
      seq: args.seq,
      txId: args.txId,
      latestRowVersion: args.latestRowVersion,
      requiresFullReload: false,
      changedRows: args.changedRows,
      deletedKeys: args.deletedKeys,
      rowMetadataMutations,
      collectionMetadataMutations,
    }
  }

  private publishTxCommittedEvent(txCommitted: TxCommitted): void {
    this.observeStreamPosition(
      txCommitted.term,
      txCommitted.seq,
      txCommitted.latestRowVersion,
    )

    const envelope: ProtocolEnvelope<TxCommitted> = {
      v: 1,
      dbName: this.dbName,
      collectionId: this.storageCollectionId,
      senderId: this.persistence.coordinator.getNodeId(),
      ts: Date.now(),
      payload: txCommitted,
    }
    this.persistence.coordinator.publish(this.storageCollectionId, envelope)
  }

  private observeStreamPosition(
    term: number,
    seq: number,
    rowVersion: number,
  ): void {
    if (
      term > this.latestTerm ||
      (term === this.latestTerm && seq > this.latestSeq)
    ) {
      this.latestTerm = term
      this.latestSeq = seq
    }
    if (rowVersion > this.latestRowVersion) {
      this.latestRowVersion = rowVersion
    }

    if (term > this.localTerm) {
      this.localTerm = term
      this.localSeq = seq
    } else if (term === this.localTerm && seq > this.localSeq) {
      this.localSeq = seq
    }
    if (rowVersion > this.localRowVersion) {
      this.localRowVersion = rowVersion
    }
  }

  private nextLocalStreamPosition(): {
    term: number
    seq: number
    rowVersion: number
  } {
    this.localTerm = Math.max(this.localTerm, this.latestTerm || 1)
    this.localSeq = Math.max(this.localSeq, this.latestSeq) + 1
    this.localRowVersion =
      Math.max(this.localRowVersion, this.latestRowVersion) + 1

    return {
      term: this.localTerm,
      seq: this.localSeq,
      rowVersion: this.localRowVersion,
    }
  }

  private getSubsetKey(options: LoadSubsetOptions): string {
    // A subscription can own several independent acquisitions, including
    // identical requests. Only releasing this options object ends its lease.
    let id = this.requestIds.get(options)
    if (id === undefined) {
      id = `request:${++this.nextRequestId}`
      this.requestIds.set(options, id)
    }
    return id
  }

  private canRouteRemoteDemandThroughCoordinator(): boolean {
    if (
      this.getCurrentTerminalFailure() ||
      this.mode !== `sync-present` ||
      this.persistence.coordinator instanceof SingleProcessCoordinator
    ) {
      return false
    }

    // A follower routes demand to the elected owner even when its own source
    // cannot own acquisitions. Only an elected node needs a local owner.
    return (
      !this.persistence.coordinator.isLeader(this.storageCollectionId) ||
      this.remoteSubsetOwnerUnsubscribe !== null
    )
  }

  private queueRemoteSubsetEnsure(options: LoadSubsetOptions): void {
    if (
      options.signal?.aborted ||
      !this.canRouteRemoteDemandThroughCoordinator() ||
      this.activeSubsets.get(this.getSubsetKey(options)) !== options
    ) {
      return
    }

    const subsetKey = this.getSubsetKey(options)
    if (this.activeSubsets.get(subsetKey) !== options) return

    // A previously local acquisition can become remote after an ownership
    // change. Recovery must reject permanent wire errors before retry owns it.
    validateRemoteSubsetOptions(options)
    this.pendingRemoteSubsetEnsures.set(subsetKey, options)
    void this.flushPendingRemoteSubsetEnsures()
  }

  private scheduleRemoteEnsureRetry(): void {
    if (
      this.getCurrentTerminalFailure() ||
      this.mode !== `sync-present` ||
      this.persistence.coordinator instanceof SingleProcessCoordinator
    ) {
      return
    }

    if (
      this.pendingRemoteSubsetEnsures.size === 0 ||
      this.remoteEnsureRetryTimer !== null
    ) {
      return
    }

    this.remoteEnsureRetryTimer = setTimeout(() => {
      this.remoteEnsureRetryTimer = null
      void this.flushPendingRemoteSubsetEnsures()
    }, REMOTE_ENSURE_RETRY_DELAY_MS)
  }

  private async flushPendingRemoteSubsetEnsures(): Promise<void> {
    if (
      this.getCurrentTerminalFailure() ||
      this.mode !== `sync-present` ||
      this.persistence.coordinator instanceof SingleProcessCoordinator
    ) {
      return
    }

    if (this.remoteEnsureRetryTimer !== null) {
      clearTimeout(this.remoteEnsureRetryTimer)
      this.remoteEnsureRetryTimer = null
    }

    for (const [subsetKey, options] of this.pendingRemoteSubsetEnsures) {
      if (
        options.signal?.aborted ||
        this.activeSubsets.get(subsetKey) !== options
      ) {
        this.pendingRemoteSubsetEnsures.delete(subsetKey)
        continue
      }
      try {
        await this.persistence.coordinator.requestEnsureRemoteSubset(
          this.storageCollectionId,
          this.rotatedAcquisitions.get(options) ?? options,
        )
        this.pendingRemoteSubsetEnsures.delete(subsetKey)
      } catch (error) {
        if (
          options.signal?.aborted ||
          this.activeSubsets.get(subsetKey) !== options
        ) {
          this.pendingRemoteSubsetEnsures.delete(subsetKey)
        } else {
          console.warn(`Failed to ensure remote subset:`, error)
        }
      }
    }

    this.scheduleRemoteEnsureRetry()
  }

  private attachCoordinatorSubscription(): void {
    if (this.coordinatorUnsubscribe) {
      return
    }

    this.persistence.coordinator.setAdapterForCollection?.(
      this.storageCollectionId,
      this.persistence.adapter,
      this.cacheGenerationClaim?.claimId,
    )
    this.coordinatorUnsubscribe = this.persistence.coordinator.subscribe(
      this.storageCollectionId,
      (message) => {
        this.onCoordinatorMessage(message)
      },
    )
  }

  private onCoordinatorMessage(message: ProtocolEnvelope<unknown>): void {
    if (message.collectionId !== this.storageCollectionId) {
      return
    }
    if (this.getCurrentTerminalFailure()) {
      return
    }
    const { payload } = message
    const lifecycleGeneration = this.lifecycleGeneration
    const isSelf = message.senderId === this.persistence.coordinator.getNodeId()
    const claimExpired = this.hasExpiredCacheClaim()
    if (claimExpired && !isTxCommittedPayload(payload)) {
      this.scheduleCacheClaimRecovery(lifecycleGeneration)
      return
    }

    // Allow tx:committed from self — the coordinator produces these on behalf
    // of both local and remote mutations. The seq dedup in
    // processCommittedTxUnsafe prevents double-processing of our own writes.
    if (isTxCommittedPayload(payload)) {
      // Commits apply in arrival order through the queue. While the claim is
      // expired, keep them until renewal or rotation decides this generation;
      // a renewed generation still owes its rows. A hydration flushes the
      // queue when it ends.
      this.queuedTxCommitted.push({
        txCommitted: payload,
        lifecycleGeneration,
        storageCollectionId: message.collectionId,
      })
      if (claimExpired) {
        this.scheduleCacheClaimRecovery(lifecycleGeneration)
      } else if (!this.isHydratingNow()) {
        void this.applyMutex
          .run(() => this.flushQueuedTxCommittedUnsafe())
          .catch((error) => {
            this.markTerminalFailure(error, lifecycleGeneration)
          })
      }
      return
    }

    // Skip remaining message types from self (e.g. heartbeats, resets)
    if (isSelf) {
      return
    }

    if (isCollectionResetPayload(payload)) {
      void this.applyMutex
        .run(async () => {
          if (message.collectionId !== this.storageCollectionId) return
          await this.runInHydrationScope(async (adapter) => {
            await this.truncateAndReloadUnsafe(adapter, lifecycleGeneration)
            await this.rebaseDurableStreamFromSnapshotUnsafe(
              adapter,
              lifecycleGeneration,
            )
            if (lifecycleGeneration === this.lifecycleGeneration) {
              // Reloaded rows and the later position-only read are separate
              // cuts. Zero is the conservative public version in the new epoch.
              this.publicRowVersion = 0
              this.resetTermFence = this.latestTerm
            }
          })
          if (lifecycleGeneration === this.lifecycleGeneration) {
            await this.flushQueuedTxCommittedUnsafe()
          }
        })
        .catch((error) => {
          this.markTerminalFailure(error, lifecycleGeneration)
        })
    }
  }

  private async flushQueuedTxCommittedUnsafe(): Promise<void> {
    while (this.queuedTxCommitted.length > 0) {
      // Claim recovery flushes the queue once the generation is decided.
      if (this.hasExpiredCacheClaim()) {
        this.scheduleCacheClaimRecovery(this.lifecycleGeneration)
        return
      }
      const queued = this.queuedTxCommitted.shift()
      if (!queued) {
        continue
      }
      if (queued.storageCollectionId !== this.storageCollectionId) continue
      // A queued commit has left the queue, so a failure must be terminal,
      // as it is for a commit applied when it arrives.
      try {
        await this.processCommittedTxUnsafe(
          queued.txCommitted,
          queued.lifecycleGeneration,
        )
      } catch (error) {
        throw this.markTerminalFailure(error, queued.lifecycleGeneration)
      }
    }
  }

  private async processCommittedTxUnsafe(
    txCommitted: TxCommitted,
    lifecycleGeneration = this.lifecycleGeneration,
  ): Promise<void> {
    if (lifecycleGeneration !== this.lifecycleGeneration) return
    if (this.resetTermFence !== undefined) {
      if (txCommitted.term <= this.resetTermFence) {
        // This payload could have been committed before the schema reset.
        // The current durable snapshot is the only safe row authority.
        await this.runInHydrationScope((adapter) =>
          this.reloadActiveSubsetsUnsafe(adapter),
        )
        return
      }
    }
    // An exact-ID reconciliation can discover a commit whose original
    // notification was lost. A peer may already be at this stream position
    // without having loaded that commit's rows.
    if (txCommitted.requiresFullReload && txCommitted.reconciliationReload) {
      await this.invalidateFromCommittedTxUnsafe(
        txCommitted,
        this.persistence.adapter,
      )
      if (lifecycleGeneration === this.lifecycleGeneration) {
        this.observeStreamPosition(
          txCommitted.term,
          txCommitted.seq,
          txCommitted.latestRowVersion,
        )
        this.publicRowVersion = Math.max(
          this.publicRowVersion,
          txCommitted.latestRowVersion,
        )
        await this.flushQueuedTxCommittedUnsafe()
      }
      return
    }
    if (txCommitted.latestRowVersion <= this.publicRowVersion) return
    const observedButUnpublished =
      txCommitted.term < this.latestTerm ||
      (txCommitted.term === this.latestTerm &&
        txCommitted.seq <= this.latestSeq)
    const hasGapInCurrentTerm =
      txCommitted.term === this.latestTerm &&
      txCommitted.seq > this.latestSeq + 1
    const hasGapAcrossTerms =
      txCommitted.term > this.latestTerm && txCommitted.seq > 1
    const hasGap =
      observedButUnpublished ||
      txCommitted.latestRowVersion > this.publicRowVersion + 1 ||
      hasGapInCurrentTerm ||
      hasGapAcrossTerms

    if (hasGap) {
      if (!(await this.recoverFromSeqGapUnsafe(lifecycleGeneration))) return
      if (lifecycleGeneration !== this.lifecycleGeneration) return
      if (txCommitted.latestRowVersion <= this.publicRowVersion) return
    }

    this.observeStreamPosition(
      txCommitted.term,
      txCommitted.seq,
      txCommitted.latestRowVersion,
    )

    await this.invalidateFromCommittedTxUnsafe(
      txCommitted,
      this.persistence.adapter,
    )
    if (lifecycleGeneration === this.lifecycleGeneration) {
      this.publicRowVersion = Math.max(
        this.publicRowVersion,
        txCommitted.latestRowVersion,
      )
      await this.flushQueuedTxCommittedUnsafe()
    }
  }

  private async rebaseDurableStreamFromSnapshotUnsafe(
    adapter: HydrationPersistenceAdapter,
    lifecycleGeneration: number,
  ): Promise<void> {
    if (lifecycleGeneration !== this.lifecycleGeneration) return
    const snapshot = await adapter.loadResumeSnapshot(this.storageTargetFor(), {
      includeRows: false,
      cacheGenerationClaimId: this.cacheGenerationClaim?.claimId,
    })
    if (lifecycleGeneration !== this.lifecycleGeneration) return
    // The reset epoch can restart row versions at zero. Keep the term/seq
    // watermark to fence old notifications, but rebase version counters.
    this.latestRowVersion = snapshot.latestRowVersion
    this.localRowVersion = snapshot.latestRowVersion
    this.observeStreamPosition(
      snapshot.latestTerm,
      snapshot.latestSeq,
      snapshot.latestRowVersion,
    )
  }

  private async recoverFromSeqGapUnsafe(
    lifecycleGeneration: number,
  ): Promise<boolean> {
    if (lifecycleGeneration !== this.lifecycleGeneration) return false
    if (this.persistence.coordinator.pullSince && this.latestRowVersion >= 0) {
      let pullResponse: PullSinceResponse | undefined
      try {
        pullResponse = await this.persistence.coordinator.pullSince(
          this.storageCollectionId,
          this.publicRowVersion,
          undefined,
          this.cacheGenerationClaim?.claimId,
        )
      } catch (error) {
        console.warn(`Failed pullSince recovery attempt:`, error)
      }

      // The replay read may have started under a live claim and returned
      // after expiry. Recovery needs the apply mutex held by this callback,
      // so schedule it after discarding the old response.
      if (this.scopedRecoveryPending) return false
      if (
        this.cacheGenerationClaim &&
        !(await this.renewCacheClaim(this.persistence.adapter))
      ) {
        this.scheduleCacheClaimRecovery(lifecycleGeneration)
        return false
      }

      if (pullResponse) {
        if (lifecycleGeneration !== this.lifecycleGeneration) return false

        if (pullResponse.ok) {
          this.observeStreamPosition(
            pullResponse.latestTerm,
            pullResponse.latestSeq,
            pullResponse.latestRowVersion,
          )
          if (pullResponse.requiresFullReload) {
            await this.runInHydrationScope((adapter) =>
              this.reloadActiveSubsetsUnsafe(adapter),
            )
            this.publicRowVersion = Math.max(
              this.publicRowVersion,
              pullResponse.latestRowVersion,
            )
            return true
          }
          const deltas = pullResponse.deltas
          if (!deltas) {
            await this.runInHydrationScope((adapter) =>
              this.reloadActiveSubsetsUnsafe(adapter),
            )
            this.publicRowVersion = Math.max(
              this.publicRowVersion,
              pullResponse.latestRowVersion,
            )
            return true
          }

          await this.runInHydrationScope(async (adapter) => {
            for (const delta of deltas) {
              if (lifecycleGeneration !== this.lifecycleGeneration) return
              await this.invalidateFromCommittedTxUnsafe(
                {
                  type: `tx:committed`,
                  term: pullResponse.latestTerm,
                  seq: pullResponse.latestSeq,
                  txId: delta.txId,
                  latestRowVersion: delta.latestRowVersion,
                  requiresFullReload: false,
                  changedRows: delta.changedRows,
                  deletedKeys: delta.deletedKeys,
                  rowMetadataMutations: delta.rowMetadataMutations,
                  collectionMetadataMutations:
                    delta.collectionMetadataMutations,
                },
                adapter,
              )
              if (lifecycleGeneration !== this.lifecycleGeneration) return
            }
          })
          this.publicRowVersion = Math.max(
            this.publicRowVersion,
            pullResponse.latestRowVersion,
          )
          return true
        }
      }
    }

    if (lifecycleGeneration !== this.lifecycleGeneration) return false
    // A gap is not a schema reset. Replace the durable snapshot in one
    // publication so readers never see an empty intermediate Collection.
    await this.runInHydrationScope((adapter) =>
      this.reloadActiveSubsetsUnsafe(adapter),
    )
    this.publicRowVersion = Math.max(
      this.publicRowVersion,
      this.latestRowVersion,
    )

    if (this.mode === `sync-present`) {
      for (const options of this.activeSubsets.values()) {
        this.queueRemoteSubsetEnsure(options)
      }
    }
    return true
  }

  private refreshScopedSubsets(): void {
    if (!this.remoteSubsetOwner) return
    const lifecycleGeneration = this.lifecycleGeneration
    const storageId = this.storageCollectionId
    for (const [subsetKey, options] of this.activeSubsets) {
      if (options.signal?.aborted) continue
      this.hydratedDemands.delete(getLoadSubsetDemandKey(options))
      // A scoped cache cannot answer the invalidation. This one-shot
      // acquisition requests source evidence while the original demand keeps
      // its lease; releasing it after settlement preserves exact ownership.
      const refreshOptions: LoadSubsetOptions = { ...options, refetch: true }
      this.scopedRefreshes.set(refreshOptions, storageId)
      void Promise.resolve()
        .then(() => {
          if (
            lifecycleGeneration !== this.lifecycleGeneration ||
            this.activeSubsets.get(subsetKey) !== options
          ) {
            return
          }
          return this.persistence.coordinator.requestEnsureRemoteSubset(
            storageId,
            refreshOptions,
          )
        })
        .catch((error: unknown) => {
          if (
            lifecycleGeneration === this.lifecycleGeneration &&
            !options.signal?.aborted
          ) {
            this.reportSyncError(error)
          }
        })
        .finally(() => {
          if (!this.scopedRefreshes.delete(refreshOptions)) return
          void this.persistence.coordinator
            .requestReleaseRemoteSubset(storageId, refreshOptions)
            .catch((error: unknown) => {
              if (lifecycleGeneration === this.lifecycleGeneration) {
                this.reportSyncError(error)
              }
            })
        })
    }
  }

  private async truncateAndReloadUnsafe(
    adapter: HydrationPersistenceAdapter,
    lifecycleGeneration = this.lifecycleGeneration,
  ): Promise<void> {
    if (lifecycleGeneration !== this.lifecycleGeneration) return
    if (this.scopedRecovery) {
      this.refreshScopedSubsets()
      return
    }
    // A subscriber may reacquire reentrantly from the truncate commit.
    this.hydratedDemands.clear()
    this.resetSequence++
    // On-demand reset keeps previously public rows and hydration seeds until
    // the new durable snapshot can replace them in one publication. Active
    // demand may add rows; retired demand may only validate visible keys.
    if (
      this.syncMode === `eager` &&
      this.syncControls.begin &&
      this.syncControls.commit
    ) {
      const applied = this.withInternalApply(() => {
        this.syncControls.begin?.()
        this.syncControls.truncate?.()
        return this.syncControls.commit?.() ?? true
      })
      await whenSyncAccepted(applied)
    }

    if (lifecycleGeneration !== this.lifecycleGeneration) return
    // A reset replays demand: the owner's reset rows return only when the
    // follower requests its demand again.
    await this.reloadActiveSubsetsUnsafe(
      adapter,
      false,
      this.syncMode === `eager`,
      true,
    )
  }

  private async invalidateFromCommittedTxUnsafe(
    txCommitted: TxCommitted,
    adapter: HydrationPersistenceAdapter,
  ): Promise<void> {
    if (this.scopedRecovery) {
      this.refreshScopedSubsets()
      return
    }
    const reloadActiveSubsets = (skipUnchangedReplace = false) =>
      this.runInHydrationScope(
        (scopedAdapter) =>
          this.reloadActiveSubsetsUnsafe(scopedAdapter, skipUnchangedReplace),
        adapter,
      )

    if (txCommitted.requiresFullReload) {
      await reloadActiveSubsets(txCommitted.reconciliationReload === true)
      return
    }

    const changedKeyCount =
      txCommitted.changedRows.length + txCommitted.deletedKeys.length
    if (changedKeyCount > TARGETED_INVALIDATION_KEY_LIMIT) {
      await reloadActiveSubsets()
      return
    }

    const hasPaginatedSubset = Array.from(this.activeSubsets.values()).some(
      (opt) => opt.limit != null || opt.offset != null || opt.cursor != null,
    )

    // A targeted envelope separates changed rows from deleted keys and omits
    // insert/update identity. A same-key insert replaces the durable row,
    // while an update merges omitted fields. The public row cannot decide
    // which operation produced a changed value. A previously unseen key also
    // has no public baseline with which to complete a source patch. Read the
    // durable result whenever that ambiguity affects a public row or demand.
    const changedKeys = new Set(txCommitted.changedRows.map((row) => row.key))
    const hasRepeatedChange =
      changedKeys.size !== txCommitted.changedRows.length
    const hasChangedAndDeletedKey = txCommitted.deletedKeys.some((key) =>
      changedKeys.has(key),
    )
    const hasChangedPublicKey = txCommitted.changedRows.some((row) =>
      this.collection?.base.has(row.key as TKey),
    )
    const hasUnseenDemandedKey =
      this.activeSubsets.size > 0 &&
      txCommitted.changedRows.some(
        (row) =>
          !this.collection?.base.has(row.key as TKey) &&
          !this.collection?._hasHydratedKey(row.key as TKey),
      )
    if (
      hasRepeatedChange ||
      hasChangedAndDeletedKey ||
      hasChangedPublicKey ||
      (this.syncMode === `on-demand` && hasUnseenDemandedKey)
    ) {
      await reloadActiveSubsets()
      return
    }

    if (!hasPaginatedSubset || changedKeyCount === 0) {
      await this.applyTargetedInvalidationUnsafe(txCommitted)
      return
    }

    // Has paginated subsets — fall back to full reload.
    // Targeted invalidation for paginated subsets is deferred to a future iteration.
    await reloadActiveSubsets()
  }

  private async applyTargetedInvalidationUnsafe(
    txCommitted: TxCommitted & { requiresFullReload: false },
  ): Promise<void> {
    const subsetEvaluators = Array.from(this.activeSubsets.values()).map(
      (opt) => (opt.where ? compileSingleRowExpression(opt.where) : null),
    )

    const applied = this.withInternalApply(() => {
      this.syncControls.begin?.()

      for (const {
        key: changedKey,
        value: newValue,
      } of txCommitted.changedRows) {
        const key = changedKey as TKey
        if (this.collection?._hasHydratedKey(key)) continue
        const previous = this.collection?.base.get(key)
        if (previous === undefined && this.activeSubsets.size === 0) continue
        const completeValue = {
          ...(previous as object | undefined),
          ...newValue,
        } as T
        const currentlyDemanded = matchesAnySubset(
          completeValue,
          subsetEvaluators,
        )
        const previouslyOutsideDemand =
          previous !== undefined &&
          !matchesAnySubset(previous, subsetEvaluators)

        if (currentlyDemanded || previouslyOutsideDemand) {
          this.syncControls.write?.({ type: `update`, value: completeValue })
        } else if (previous !== undefined) {
          this.syncControls.write?.({ type: `delete`, key })
        }
      }

      for (const deletedKey of txCommitted.deletedKeys) {
        const key = deletedKey as TKey
        if (!this.collection?._hasHydratedKey(key)) {
          this.syncControls.write?.({ type: `delete`, key })
        }
      }

      txCommitted.rowMetadataMutations?.forEach((mutation) => {
        // A DbClient hydration seed owns both its row and row metadata until
        // an accepted source transaction confirms the key.
        if (this.collection?._hasHydratedKey(mutation.key as TKey)) return
        applyMetadataWrite(
          this.syncControls.metadata?.row,
          mutation.key as TKey,
          mutation,
        )
      })

      txCommitted.collectionMetadataMutations?.forEach((mutation) => {
        applyMetadataWrite(
          this.syncControls.metadata?.collection,
          mutation.key,
          mutation,
        )
      })

      return this.syncControls.commit?.() ?? true
    })
    await whenSyncAccepted(applied)
  }

  private async reloadActiveSubsetsUnsafe(
    adapter: HydrationPersistenceAdapter,
    skipUnchangedReplace = false,
    restoreResetBaseline = false,
    replayDemand = false,
  ): Promise<void> {
    if (this.scopedRecovery) {
      this.refreshScopedSubsets()
      return
    }
    const lifecycleGeneration = this.lifecycleGeneration
    const truncateGeneration = this.sourceTruncateGeneration
    const activeSubsetOptions = Array.from(this.activeSubsets.values())
    if (restoreResetBaseline && activeSubsetOptions.length === 0) {
      activeSubsetOptions.push({})
    }
    const evaluators = activeSubsetOptions.map((options) =>
      options.where ? compileSingleRowExpression(options.where) : null,
    )
    // A filtered read has no authority over public rows that were already
    // outside every active predicate. Validate those keys against the complete
    // durable snapshot; only active demand may admit previously unseen keys.
    const outsideDemandKeys = activeSubsetOptions.some(
      (options) =>
        options.limit != null ||
        options.offset != null ||
        options.cursor != null,
    )
      ? []
      : Array.from(this.collection?.base ?? [])
          .filter(
            ([key, row]) =>
              !this.collection?._hasHydratedKey(key) &&
              !matchesAnySubset(row, evaluators),
          )
          .map(([key]) => key)

    this.hydratedDemands.clear()
    this.hydrationSequence++
    const hydrationContext = { suppliedRowKeys: new Set<TKey>() }
    this.activeHydrationContext = hydrationContext
    this.hydratingGeneration = lifecycleGeneration
    try {
      const mergedRows = new Map<TKey, { value: T; metadata?: unknown }>()
      let validationSnapshot:
        Awaited<ReturnType<typeof adapter.loadResumeSnapshot>> | undefined
      let collectionMetadata: Array<{ key: string; value: unknown }> = []
      try {
        validationSnapshot =
          (activeSubsetOptions.length === 0 || outsideDemandKeys.length > 0) &&
          this.collection?.base.size
            ? await adapter.loadResumeSnapshot(this.storageTargetFor(), {
                requiredIndexSignatures: this.getRequiredIndexSignatures(),
                includeRows: true,
                cacheGenerationClaimId: this.cacheGenerationClaim?.claimId,
              })
            : undefined
        collectionMetadata = validationSnapshot
          ? validationSnapshot.collectionMetadata
          : await this.loadCollectionMetadataSnapshot(adapter)
        if (lifecycleGeneration !== this.lifecycleGeneration) return
        for (const options of activeSubsetOptions) {
          const subsetRows = await this.loadSubsetRowsUnsafe(options, adapter)
          if (lifecycleGeneration !== this.lifecycleGeneration) return
          for (const row of subsetRows) {
            mergedRows.set(row.key, {
              value: row.value,
              metadata: row.metadata,
            })
          }
        }
        if (outsideDemandKeys.length > 0 && validationSnapshot) {
          const durableRows = new Map(
            validationSnapshot.rows.map((row) => [row.key, row]),
          )
          for (const key of outsideDemandKeys) {
            if (mergedRows.has(key)) continue
            const row = durableRows.get(key)
            if (row) {
              mergedRows.set(key, {
                value: row.value as T,
                metadata: row.metadata,
              })
            }
          }
        }
      } catch (error) {
        // Recovery may have started while the adapter read was awaited.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.scopedRecovery) return
        // SQLite may reject its second read-admission check after a claim
        // expires. A read from that cache has no authority to fail the
        // Collection; recovery will reload its active demands.
        if (!this.cacheGenerationClaim || !this.hasExpiredCacheClaim()) {
          throw error
        }
        this.scheduleCacheClaimRecovery(lifecycleGeneration)
        return
      }

      // A peer reload can hold its persisted read past claim expiry. Its
      // rows and metadata cannot publish under the old generation. Recovery
      // needs this apply mutex, so start it only after this callback returns.
      if (this.isScopedRecoveryPending()) return
      if (this.cacheGenerationClaim && !(await this.renewCacheClaim(adapter))) {
        this.scheduleCacheClaimRecovery(lifecycleGeneration)
        return
      }
      if (
        this.isScopedRecoveryPending() ||
        lifecycleGeneration !== this.lifecycleGeneration
      )
        return

      for (const key of mergedRows.keys()) {
        hydrationContext.suppliedRowKeys.add(key)
      }

      if (activeSubsetOptions.length === 0) {
        // Retired demand does not hide already public rows. Validate only
        // those keys; do not publish unrelated durable rows without demand.
        await whenSyncAccepted(
          this.applyRowsToCollection(
            [],
            (validationSnapshot?.rows ?? []) as Array<{
              key: TKey
              value: T
              metadata?: unknown
            }>,
            collectionMetadata,
          ),
        )
      } else if (
        skipUnchangedReplace &&
        this.matchesCollectionSnapshot(mergedRows, collectionMetadata)
      ) {
        // A full replacement would also clear metadata for missing rows.
        // Clear only those entries so equal public rows do not republish.
        const orphanKeys =
          this.collection?._syncedRowMetadataKeysOutsideBase() ?? []
        if (orphanKeys.length > 0) {
          const applied = this.withInternalApply(() => {
            this.syncControls.begin?.()
            for (const key of orphanKeys) {
              this.syncControls.metadata?.row.delete(key)
            }
            return this.syncControls.commit?.() ?? true
          })
          await whenSyncAccepted(applied)
        }
      } else {
        const applied = this.replaceCollectionSnapshot(
          Array.from(mergedRows.entries()).map(([key, row]) => ({
            key,
            value: row.value,
            metadata: row.metadata,
          })),
          collectionMetadata,
          replayDemand,
        )
        await whenSyncAccepted(applied)
      }
    } finally {
      if (
        this.activeHydrationContext === hydrationContext &&
        this.hydratingGeneration === lifecycleGeneration
      ) {
        this.hydratingGeneration = null
      }
      if (this.activeHydrationContext === hydrationContext) {
        this.activeHydrationContext = undefined
      }
    }
    if (lifecycleGeneration === this.lifecycleGeneration) {
      await this.flushQueuedHydrationTransactionsUnsafe(adapter)
      // Coordinator commits queued during this hydrate are processed outside
      // its scope. Leave the synchronous fast path closed until a later load
      // if any such commit still needs to be applied.
      if (
        truncateGeneration === this.sourceTruncateGeneration &&
        this.queuedTxCommitted.length === 0
      ) {
        for (const options of activeSubsetOptions) {
          if (this.activeSubsets.get(this.getSubsetKey(options)) === options) {
            this.hydratedDemands.add(getLoadSubsetDemandKey(options))
          }
        }
      }
    }
  }

  private attachIndexLifecycleListeners(): void {
    if (
      !this.collection ||
      this.indexAddedUnsubscribe ||
      this.indexRemovedUnsubscribe
    ) {
      return
    }

    this.indexAddedUnsubscribe = this.collection.on(`index:added`, (event) => {
      void this.ensurePersistedIndex(event.index).catch((error) => {
        console.warn(
          `Failed to ensure persisted index after index:added:`,
          error,
        )
      })
    })
    this.indexRemovedUnsubscribe = this.collection.on(
      `index:removed`,
      (event) => {
        void this.markIndexRemoved(event.index)
      },
    )
  }

  private async bootstrapPersistedIndexes(
    indexMetadataSnapshot?: Array<CollectionIndexMetadata>,
    adapter: HydrationPersistenceAdapter = this.persistence.adapter,
  ): Promise<Set<string>> {
    const collection = this.collection
    if (!collection && !indexMetadataSnapshot) {
      return new Set()
    }

    const indexMetadata =
      indexMetadataSnapshot ?? collection?.getIndexMetadata() ?? []
    const completedLocalIndexSignatures = new Set<string>()
    const lifecycleGeneration = this.lifecycleGeneration
    for (const metadata of indexMetadata) {
      const storageCollectionId = this.storageCollectionId
      const claimId = this.cacheGenerationClaim?.claimId
      const ensured = await this.ensureLocalPersistedIndex(metadata, adapter)
      if (
        ensured &&
        (await this.reconcilePersistedIndex(
          metadata,
          adapter,
          storageCollectionId,
          claimId,
          lifecycleGeneration,
          true,
        ))
      ) {
        completedLocalIndexSignatures.add(metadata.signature)
      }
    }
    return completedLocalIndexSignatures
  }

  private async requestCoordinatorPersistedIndexes(
    indexMetadata: Array<CollectionIndexMetadata>,
    completedLocalIndexSignatures: ReadonlySet<string>,
  ): Promise<void> {
    const lifecycleGeneration = this.lifecycleGeneration
    for (const metadata of indexMetadata) {
      if (!this.hasCurrentIndex(metadata)) continue
      const storageCollectionId = this.storageCollectionId
      const claimId = this.cacheGenerationClaim?.claimId
      await this.requestCoordinatorPersistedIndex(
        metadata,
        completedLocalIndexSignatures.has(metadata.signature),
      )
      await this.reconcilePersistedIndex(
        metadata,
        this.persistence.adapter,
        storageCollectionId,
        claimId,
        lifecycleGeneration,
        true,
      )
    }
  }

  /** Settle a late index operation against the Collection's current declaration. */
  private async reconcilePersistedIndex(
    indexMetadata: CollectionIndexMetadata,
    adapter: HydrationPersistenceAdapter,
    storageCollectionId: string,
    claimId: string | undefined,
    lifecycleGeneration: number,
    indexPresent: boolean,
  ): Promise<boolean> {
    while (
      lifecycleGeneration === this.lifecycleGeneration &&
      storageCollectionId === this.storageCollectionId
    ) {
      const declared = this.hasCurrentIndex(indexMetadata)
      if (declared === indexPresent) return declared
      if (declared) {
        if (!(await this.ensureLocalPersistedIndex(indexMetadata, adapter))) {
          return false
        }
      } else {
        if (!adapter.markIndexRemoved) return false
        try {
          await adapter.markIndexRemoved(
            this.storageTargetFor(storageCollectionId, claimId),
            indexMetadata.signature,
            { cacheGenerationClaimId: claimId },
          )
        } catch (error) {
          console.warn(`Failed to mark persisted index removed:`, error)
          return false
        }
      }
      indexPresent = declared
    }
    return false
  }

  private buildPersistedIndexSpec(
    index: CollectionIndexMetadata,
  ): PersistedIndexSpec {
    return {
      expressionSql: [stableSerialize(index.expression)],
      metadata: {
        name: index.name ?? null,
        resolver: toStableSerializable(index.resolver),
        options: toStableSerializable(index.options),
      },
    }
  }

  private async ensurePersistedIndex(
    indexMetadata: CollectionIndexMetadata,
    adapter: HydrationPersistenceAdapter = this.persistence.adapter,
  ): Promise<void> {
    if (this.scopedRecoveryPending) return
    const lifecycleGeneration = this.lifecycleGeneration
    await this.ensureCacheClaimActive()
    if (
      lifecycleGeneration !== this.lifecycleGeneration ||
      !this.hasCurrentIndex(indexMetadata)
    )
      return
    const completedLocally = await this.ensureLocalPersistedIndex(
      indexMetadata,
      adapter,
    )
    if (lifecycleGeneration !== this.lifecycleGeneration) return
    if (!this.hasCurrentIndex(indexMetadata)) {
      await this.markIndexRemoved(indexMetadata)
      return
    }
    await this.requestCoordinatorPersistedIndex(indexMetadata, completedLocally)
    if (
      lifecycleGeneration === this.lifecycleGeneration &&
      !this.hasCurrentIndex(indexMetadata)
    ) {
      await this.markIndexRemoved(indexMetadata)
    }
  }

  private hasCurrentIndex(indexMetadata: CollectionIndexMetadata): boolean {
    return (
      this.collection
        ?.getIndexMetadata()
        .some((current) => current.signature === indexMetadata.signature) ??
      false
    )
  }

  private async ensureLocalPersistedIndex(
    indexMetadata: CollectionIndexMetadata,
    adapter: HydrationPersistenceAdapter,
  ): Promise<boolean> {
    try {
      const spec = this.buildPersistedIndexSpec(indexMetadata)
      await adapter.ensureIndex(
        this.storageTargetFor(),
        indexMetadata.signature,
        spec,
        { cacheGenerationClaimId: this.cacheGenerationClaim?.claimId },
      )
      return true
    } catch (error) {
      console.warn(`Failed to ensure persisted index in adapter:`, error)
      return false
    }
  }

  private async requestCoordinatorPersistedIndex(
    indexMetadata: CollectionIndexMetadata,
    completedLocally: boolean,
  ): Promise<void> {
    try {
      const spec = this.buildPersistedIndexSpec(indexMetadata)
      await this.persistence.coordinator.requestEnsurePersistedIndex(
        this.storageCollectionId,
        indexMetadata.signature,
        spec,
        completedLocally ? this.persistence.adapter : undefined,
        completedLocally,
        this.cacheGenerationClaim?.claimId,
      )
    } catch (error) {
      console.warn(
        `Failed to ensure persisted index through coordinator:`,
        error,
      )
    }
  }

  private async markIndexRemoved(
    indexMetadata: CollectionIndexMetadata,
  ): Promise<void> {
    if (!this.persistence.adapter.markIndexRemoved) {
      return
    }

    try {
      if (this.scopedRecoveryPending) return
      const lifecycleGeneration = this.lifecycleGeneration
      await this.ensureCacheClaimActive()
      if (
        lifecycleGeneration !== this.lifecycleGeneration ||
        this.hasCurrentIndex(indexMetadata)
      )
        return
      await this.persistence.adapter.markIndexRemoved(
        this.storageTargetFor(),
        indexMetadata.signature,
        { cacheGenerationClaimId: this.cacheGenerationClaim?.claimId },
      )
      if (
        lifecycleGeneration === this.lifecycleGeneration &&
        this.hasCurrentIndex(indexMetadata)
      ) {
        await this.ensurePersistedIndex(indexMetadata)
      }
    } catch (error) {
      console.warn(`Failed to mark persisted index removed:`, error)
    }
  }
}

function createWrappedSyncConfig<
  T extends object,
  TKey extends string | number,
>(
  sourceSyncConfig: SyncConfig<T, TKey>,
  runtime: PersistedCollectionRuntime<T, TKey>,
  persistedReadiness?: PersistedReadinessTracker,
): SyncConfig<T, TKey> {
  return {
    ...sourceSyncConfig,
    sync: (params) => {
      const transactionStack: Array<OpenSyncTransaction<T, TKey>> = []
      const pendingPublicationTransactions: Array<
        OpenSyncTransaction<T, TKey>
      > = []
      const getOpenTransaction = () =>
        transactionStack[transactionStack.length - 1]
      const settlePublicationAdmissionWaiters = (
        transaction: OpenSyncTransaction<T, TKey>,
        error?: unknown,
      ) => {
        const waiters = transaction.publicationAdmissionWaiters
        transaction.publicationAdmissionWaiters = undefined
        if (!waiters) return
        for (const waiter of waiters) {
          if (error === undefined) waiter.resolve()
          else waiter.reject(error)
        }
      }
      const bindToCurrentHydration = (
        transaction: OpenSyncTransaction<T, TKey>,
      ) => {
        if (transaction.internal || !runtime.isHydratingNow()) return
        const hydrationSequence = runtime.getHydrationSequence()
        if (
          transaction.hydrationSequence !== undefined &&
          transaction.hydrationSequence !== hydrationSequence
        ) {
          throw new InvalidPersistedCollectionConfigError(
            `a persisted sync transaction cannot cross a hydration cycle`,
          )
        }
        transaction.queuedBecauseHydrating = true
        transaction.hydrationSequence = hydrationSequence
        transaction.hydrationContext = runtime.getActiveHydrationContext()
      }
      const assertHydrationSequenceCurrent = (
        transaction: OpenSyncTransaction<T, TKey>,
      ) => {
        if (
          transaction.hydrationSequence !== undefined &&
          transaction.hydrationSequence !== runtime.getHydrationSequence()
        ) {
          throw new InvalidPersistedCollectionConfigError(
            `a persisted sync transaction cannot cross a hydration cycle`,
          )
        }
      }
      const markPendingMetadataDependency = (
        transaction: OpenSyncTransaction<T, TKey>,
      ) => {
        const openTransaction = getOpenTransaction()
        if (openTransaction && !openTransaction.internal) {
          transaction.hasDependentSuccessor = true
        }
      }
      const removePendingPublicationTransaction = (
        transaction: OpenSyncTransaction<T, TKey>,
      ) => {
        const index = pendingPublicationTransactions.indexOf(transaction)
        if (index === -1) return
        pendingPublicationTransactions.splice(index, 1)
        // A deferred transaction that never reaches the Collection releases
        // the optimistic rows it held.
        if (!transaction.handedToCollection)
          params.collection._state.recomputeOptimisticState(false)
      }
      // Committed source transactions not yet handed to the Collection. Core
      // holds settled optimistic rows on their keys until they apply.
      params.collection._state.setDeferredSyncKeys((key) =>
        pendingPublicationTransactions.some(
          (transaction) =>
            !transaction.handedToCollection &&
            transaction.operationKeys.has(key),
        ),
      )
      // A source receipt is accepted once its rows are durable, and resolves
      // when core makes them visible.
      const visibleAfterDurable = (
        transaction: OpenSyncTransaction<T, TKey>,
        durable: Promise<void>,
      ): Promise<void> => {
        const visible = durable.then(async () => {
          const receipt = transaction.applicationReceipt
          if (receipt !== undefined && receipt !== true) await receipt
        })
        void visible.catch(() => undefined)
        return withAcceptedReceipt(visible, durable)
      }
      const settleRuntimeTransaction = (
        transaction: OpenSyncTransaction<T, TKey>,
        applied: Promise<void>,
      ) => {
        const settle = () => removePendingPublicationTransaction(transaction)
        void applied.then(settle, settle)
      }
      const metadataValue = (write: MetadataWrite) =>
        write.type === `delete` ? undefined : write.value
      // A metadata read sees the open transaction's write, then the newest
      // staged one, then the Collection's. A truncate hides older row
      // metadata. Reading a staged write makes its transaction a dependency.
      const readStagedMetadata = <K>(
        key: K,
        getMap: (
          transaction: OpenSyncTransaction<T, TKey>,
        ) => Map<K, MetadataWrite>,
        truncates: boolean,
        stored: () => unknown,
      ): unknown => {
        if (startupState.cleanedUp) return undefined
        const openTransaction = getOpenTransaction()
        const openWrite = openTransaction && getMap(openTransaction).get(key)
        if (openWrite) return metadataValue(openWrite)
        if (truncates && openTransaction?.truncate) return undefined
        for (
          let index = pendingPublicationTransactions.length - 1;
          index >= 0;
          index--
        ) {
          const transaction = pendingPublicationTransactions[index]!
          const write = getMap(transaction).get(key)
          if (write || (truncates && transaction.truncate)) {
            markPendingMetadataDependency(transaction)
            return write && metadataValue(write)
          }
        }
        return stored()
      }
      const abortPublicationTransaction = (
        transaction: OpenSyncTransaction<T, TKey>,
        error: unknown,
      ) => {
        removePendingPublicationTransaction(transaction)
        settlePublicationAdmissionWaiters(transaction, error)
        return createHandledRejection(error)
      }
      const updateMetadataWrite = <K>(
        key: K,
        write: MetadataWrite,
        getMap: (
          transaction: OpenSyncTransaction<T, TKey>,
        ) => Map<K, MetadataWrite>,
        contextName: string,
      ) => {
        if (startupState.cleanedUp) return
        const openTransaction = getOpenTransaction()
        if (openTransaction?.terminalFailure ?? getTerminalFailure()) return
        if (!openTransaction) {
          throw new InvalidPersistedCollectionConfigError(
            `${contextName} must be called within an open sync transaction`,
          )
        }
        getMap(openTransaction).set(key, write)
      }
      let fullStartPromise: Promise<void> | null = null
      let sourceResultPromise: Promise<SyncConfigRes> | null = null
      let resolveSourceResultAssigned!: () => void
      const sourceResultAssigned = new Promise<void>((resolve) => {
        resolveSourceResultAssigned = resolve
      })
      const startupState = { cleanedUp: false }
      const isCleanedUp = () => startupState.cleanedUp
      type SubsetAcquisition = {
        forwarded: boolean
        source?: SyncConfigRes
        cancelAdmissionWait?: () => void
      }
      const acquisitions = new Map<LoadSubsetOptions, SubsetAcquisition>()
      const waitForPublicationAdmission = (
        transaction: OpenSyncTransaction<T, TKey>,
        options: LoadSubsetOptions,
        acquisition: SubsetAcquisition,
      ): Promise<void> => {
        if (options.signal?.aborted) {
          return Promise.reject(
            options.signal.reason ?? new SyncTransactionAbortedError(),
          )
        }
        return new Promise<void>((resolve, reject) => {
          const waiters =
            transaction.publicationAdmissionWaiters ??
            (transaction.publicationAdmissionWaiters = new Set())
          let settled = false
          const settle = (action: () => void) => {
            if (settled) return
            settled = true
            waiters.delete(waiter)
            options.signal?.removeEventListener(`abort`, abort)
            acquisition.cancelAdmissionWait = undefined
            action()
          }
          const waiter = {
            resolve: () => settle(resolve),
            reject: (error: unknown) => settle(() => reject(error)),
          }
          const abort = () =>
            waiter.reject(
              options.signal?.reason ?? new SyncTransactionAbortedError(),
            )
          waiters.add(waiter)
          options.signal?.addEventListener(`abort`, abort, { once: true })
          acquisition.cancelAdmissionWait = waiter.resolve
        })
      }
      const getTerminalFailure = () => runtime.getCurrentTerminalFailure()
      const reportUpstreamError = (error: unknown) => {
        if (persistedReadiness?.getSnapshot().status !== `loading`) {
          runtime.reportSyncError(error)
          return
        }
        // An early network error must not stop the live-query graph before
        // the persisted baseline has published its rows.
        void (fullStartPromise ?? runtime.ensureStarted()).then(
          () => {
            if (!isCleanedUp() && !getTerminalFailure()) {
              runtime.reportSyncError(error)
            }
          },
          () => undefined,
        )
      }
      const createHandledRejection = (error: unknown): Promise<never> => {
        const rejected = Promise.reject(error)
        void rejected.catch(() => undefined)
        return rejected
      }
      const applyTransactionToCollection = (
        transaction: OpenSyncTransaction<T, TKey>,
        signal?: AbortSignal,
      ): SyncAppliedReceipt => {
        if (transaction.applicationReceipt !== undefined) {
          return transaction.applicationReceipt
        }
        try {
          assertHydrationSequenceCurrent(transaction)
          for (const key of transaction.deferredHydrationMetadataDeleteKeys) {
            if (
              !transaction.hydrationContext?.suppliedRowKeys.has(key) &&
              !transaction.rowMetadataWrites.has(key)
            ) {
              transaction.rowMetadataWrites.set(key, { type: `delete` })
            }
          }
          transaction.deferredHydrationMetadataDeleteKeys.clear()

          params.begin()
          if (transaction.truncate) params.truncate()
          for (const operation of transaction.operations) {
            if (operation.type === `delete`) {
              params.write({ type: `delete`, key: operation.key })
            } else {
              params.write({
                type: `update`,
                value: operation.value,
                metadata: operation.metadata,
              })
            }
          }
          if (params.metadata) {
            for (const [key, write] of transaction.rowMetadataWrites) {
              applyMetadataWrite(params.metadata.row, key, write)
            }
            for (const [key, write] of transaction.collectionMetadataWrites) {
              applyMetadataWrite(params.metadata.collection, key, write)
            }
          }

          // Core takes the transaction in `commit()` unless its signal has
          // aborted; only then do core's own holds cover its keys.
          transaction.handedToCollection = signal?.aborted !== true
          const applied = params.commit(signal)
          transaction.applicationReceipt = applied
          // Core accepted the transaction, so it is no longer staged here;
          // the receipt resolves when it is visible.
          removePendingPublicationTransaction(transaction)
          if (applied !== true) void applied.catch(() => undefined)
          return applied
        } catch (error) {
          transaction.handedToCollection = false
          removePendingPublicationTransaction(transaction)
          throw error
        }
      }
      runtime.setCollection(
        params.collection as Collection<T, TKey, PersistedCollectionUtils>,
        {
          begin: params.begin,
          write: params.write as SyncControlFns<T, TKey>[`write`],
          commit: params.commit,
          truncate: params.truncate,
          metadata: params.metadata ?? null,
          markError: params.markError,
        },
      )

      const persistenceCapability: SyncPersistenceCapabilityV1<TKey> = {
        protocol: SYNC_PERSISTENCE_PROTOCOL,
        version: SYNC_PERSISTENCE_VERSION,
        get managedCacheGeneration() {
          return runtime.hasManagedCacheGeneration()
        },
        get startupCacheGenerationRotated() {
          return runtime.hasRotatedStartupCacheGeneration()
        },
        reserveCommitTurn: () => {
          const openTransaction = getOpenTransaction()
          if (openTransaction && !openTransaction.internal)
            openTransaction.reservesCommitTurn = true
        },
        hydrateBaseline: async () => {
          if (startupState.cleanedUp) return
          try {
            await runtime.ensureResumeBaselineHydrated()
          } catch (error) {
            throw runtime.reportSyncError(error)
          }
        },
        startScopedRecovery: (resetMetadata) =>
          startupState.cleanedUp
            ? Promise.resolve()
            : runtime.startScopedRecovery(resetMetadata),
        scanPersistedRows: (options) =>
          startupState.cleanedUp
            ? Promise.resolve([])
            : runtime.scanPersistedRows(options),
        resumeSnapshot: {
          certify: async () => {
            if (startupState.cleanedUp) return
            try {
              await runtime.ensureResumeBaselineCertified()
            } catch (error) {
              throw runtime.reportSyncError(error)
            }
          },
          getKeySetEvidence: () =>
            startupState.cleanedUp ? undefined : runtime.getKeySetEvidence(),
          expectCurrentCommit: () => {
            if (startupState.cleanedUp) return
            const openTransaction = getOpenTransaction()
            if (!openTransaction) {
              throw new InvalidPersistedCollectionConfigError(
                `resumeSnapshot.expectCurrentCommit must be called within an open sync transaction`,
              )
            }
            openTransaction.expectedResumeGenerationOwner =
              runtime.getResumeGenerationOwner()
          },
        },
      }

      let sourceSession = 0
      const wrappedParams = {
        ...params,
        markError: reportUpstreamError,
        markReady: () => {
          if (startupState.cleanedUp || getTerminalFailure()) return
          void (fullStartPromise ?? runtime.ensureStarted())
            .then(async () => {
              if (isCleanedUp() || getTerminalFailure()) return
              await sourceResultAssigned
              try {
                await sourceResultPromise
              } catch (error) {
                reportUpstreamError(error)
                return
              }
              if (isCleanedUp() || getTerminalFailure()) return
              params.markReady()
            })
            .catch(() => undefined)
        },
        begin: () => {
          if (startupState.cleanedUp) return undefined
          const terminalFailure = getTerminalFailure()
          const internal = runtime.isApplyingInternally()
          const transaction: OpenSyncTransaction<T, TKey> = {
            operations: [],
            partialUpdateOperationIndexes: new Set(),
            rowMetadataWrites: new Map(),
            collectionMetadataWrites: new Map(),
            deferredHydrationMetadataDeleteKeys: new Set(),
            truncate: false,
            internal,
            lifecycleGeneration: runtime.getLifecycleGeneration(),
            operationKeys: new Set(),
            hasDependentSuccessor: false,
            queuedBecauseHydrating:
              terminalFailure === undefined &&
              !internal &&
              runtime.isHydratingNow(),
            hydrationSequence:
              terminalFailure === undefined && !internal
                ? runtime.getHydrationSequence()
                : undefined,
            hydrationContext:
              terminalFailure === undefined &&
              !internal &&
              runtime.isHydratingNow()
                ? runtime.getActiveHydrationContext()
                : undefined,
            ...(terminalFailure === undefined ? {} : { terminalFailure }),
          }
          transactionStack.push(transaction)
        },
        write: (message: ChangeMessageOrDeleteKeyMessage<T, TKey>) => {
          if (startupState.cleanedUp) return
          const openTransaction = getOpenTransaction()
          const terminalFailure =
            openTransaction?.terminalFailure ?? getTerminalFailure()
          if (terminalFailure) {
            if (openTransaction)
              openTransaction.terminalFailure = terminalFailure
            return
          }
          if (!openTransaction) {
            throw new NoPendingSyncTransactionWriteError()
          }
          bindToCurrentHydration(openTransaction)
          const normalization = runtime.normalizeSyncWriteMessage(message)

          if (
            message.type === `update` &&
            sourceSyncConfig.rowUpdateMode !== `full`
          ) {
            if (!openTransaction.internal) {
              openTransaction.partialUpdateOperationIndexes.add(
                openTransaction.operations.length,
              )
            }
            for (const pending of pendingPublicationTransactions) {
              if (
                pending.truncate ||
                pending.operationKeys.has(normalization.operation.key)
              ) {
                markPendingMetadataDependency(pending)
              }
            }
          }

          openTransaction.operations.push(normalization.operation)
          openTransaction.operationKeys.add(normalization.operation.key)
          if (normalization.operation.type === `delete`) {
            openTransaction.rowMetadataWrites.set(normalization.operation.key, {
              type: `delete`,
            })
          } else if (
            message.type === `insert` &&
            normalization.operation.metadata === undefined
          ) {
            // Reset stale metadata for a fresh insert, but don't clobber an
            // explicit metadata write already queued for this key in the same
            // transaction (e.g. query reconcile stamps owners, then inserts).
            if (openTransaction.queuedBecauseHydrating) {
              openTransaction.deferredHydrationMetadataDeleteKeys.add(
                normalization.operation.key,
              )
            } else if (
              !openTransaction.rowMetadataWrites.has(
                normalization.operation.key,
              )
            ) {
              openTransaction.rowMetadataWrites.set(
                normalization.operation.key,
                {
                  type: `delete`,
                },
              )
            }
          } else if (normalization.operation.metadata !== undefined) {
            openTransaction.rowMetadataWrites.set(normalization.operation.key, {
              type: `set`,
              value: normalization.operation.metadata,
            })
          }
        },
        metadata: params.metadata
          ? {
              persistence: persistenceCapability,
              row: {
                get: (key: TKey) =>
                  readStagedMetadata(
                    key,
                    (transaction) => transaction.rowMetadataWrites,
                    true,
                    () => params.metadata!.row.get(key),
                  ),
                set: (key: TKey, value: unknown) => {
                  updateMetadataWrite(
                    key,
                    { type: `set`, value },
                    (t) => t.rowMetadataWrites,
                    `metadata.row.set`,
                  )
                },
                delete: (key: TKey) => {
                  updateMetadataWrite(
                    key,
                    { type: `delete` },
                    (t) => t.rowMetadataWrites,
                    `metadata.row.delete`,
                  )
                },
              },
              collection: {
                get: (key: string) =>
                  readStagedMetadata(
                    key,
                    (transaction) => transaction.collectionMetadataWrites,
                    false,
                    () => params.metadata!.collection.get(key),
                  ),
                set: (key: string, value: unknown) => {
                  updateMetadataWrite(
                    key,
                    { type: `set`, value },
                    (t) => t.collectionMetadataWrites,
                    `metadata.collection.set`,
                  )
                },
                delete: (key: string) => {
                  updateMetadataWrite(
                    key,
                    { type: `delete` },
                    (t) => t.collectionMetadataWrites,
                    `metadata.collection.delete`,
                  )
                },
                list: (prefix?: string) => {
                  if (startupState.cleanedUp) return []
                  const merged = new Map(
                    params
                      .metadata!.collection.list()
                      .map(({ key, value }) => [key, value]),
                  )
                  const pendingOwners = new Map<
                    string,
                    OpenSyncTransaction<T, TKey>
                  >()
                  for (const transaction of pendingPublicationTransactions) {
                    for (const [
                      key,
                      metadataWrite,
                    ] of transaction.collectionMetadataWrites) {
                      if (!prefix || key.startsWith(prefix)) {
                        pendingOwners.set(key, transaction)
                      }
                      applyMetadataWrite(merged, key, metadataWrite)
                    }
                  }
                  for (const owner of new Set(pendingOwners.values())) {
                    markPendingMetadataDependency(owner)
                  }
                  const openTransaction = getOpenTransaction()
                  if (openTransaction) {
                    for (const [
                      key,
                      metadataWrite,
                    ] of openTransaction.collectionMetadataWrites) {
                      applyMetadataWrite(merged, key, metadataWrite)
                    }
                  }

                  return Array.from(merged.entries())
                    .filter(([key]) => (prefix ? key.startsWith(prefix) : true))
                    .map(([key, value]) => ({
                      key,
                      value,
                    }))
                },
              },
            }
          : undefined,
        truncate: () => {
          if (startupState.cleanedUp) return
          runtime.noteSourceTruncate()
          const openTransaction = getOpenTransaction()
          if (openTransaction?.terminalFailure ?? getTerminalFailure()) return
          if (!openTransaction) {
            throw new NoPendingSyncTransactionWriteError()
          }

          openTransaction.operations = []
          openTransaction.operationKeys.clear()
          openTransaction.partialUpdateOperationIndexes.clear()
          openTransaction.rowMetadataWrites.clear()
          openTransaction.deferredHydrationMetadataDeleteKeys.clear()
          // Intentionally preserve collectionMetadataWrites across truncate.
          // Callers (for example electric resume/reset handling) may stage
          // collection-scoped metadata before truncating row data, and those
          // writes must commit atomically with the truncate transaction.
          openTransaction.truncate = true
        },
        commit: (signal?: AbortSignal) => {
          if (startupState.cleanedUp) return true
          const openTransaction = transactionStack.pop()
          const terminalFailure =
            openTransaction?.terminalFailure ?? getTerminalFailure()
          if (terminalFailure) {
            if (openTransaction) {
              return abortPublicationTransaction(
                openTransaction,
                terminalFailure.error,
              )
            }
            return createHandledRejection(terminalFailure.error)
          }
          if (!openTransaction) {
            throw new NoPendingSyncTransactionCommitError()
          }

          if (openTransaction.internal) {
            return applyTransactionToCollection(openTransaction, signal)
          }

          if (signal?.aborted) {
            const error = new SyncTransactionAbortedError()
            return abortPublicationTransaction(openTransaction, error)
          }
          if (runtime.isScopedRecoveryPending()) {
            const error = new SyncTransactionAbortedError()
            return abortPublicationTransaction(openTransaction, error)
          }
          try {
            bindToCurrentHydration(openTransaction)
            assertHydrationSequenceCurrent(openTransaction)
          } catch (error) {
            settlePublicationAdmissionWaiters(openTransaction, error)
            throw error
          }
          const transaction = {
            operations: openTransaction.operations,
            partialUpdateOperationIndexes:
              openTransaction.partialUpdateOperationIndexes,
            rowMetadataWrites: openTransaction.rowMetadataWrites,
            collectionMetadataWrites: openTransaction.collectionMetadataWrites,
            deferredHydrationMetadataDeleteKeys:
              openTransaction.deferredHydrationMetadataDeleteKeys,
            hydrationContext: openTransaction.hydrationContext,
            hydrationSequence: openTransaction.hydrationSequence,
            truncate: openTransaction.truncate,
            internal: false,
            lifecycleGeneration: openTransaction.lifecycleGeneration,
            expectedResumeGenerationOwner:
              openTransaction.expectedResumeGenerationOwner,
            signal,
            prependHydrationRows: (
              rows: Array<{ key: TKey; value: T; metadata?: unknown }>,
            ) => {
              const baselineOperations: Array<
                NormalizedSyncOperation<T, TKey>
              > = rows.map(({ key, value, metadata }) => ({
                type: `update`,
                key,
                value,
                metadata: metadata as Record<string, unknown> | undefined,
              }))
              openTransaction.operations = baselineOperations.concat(
                openTransaction.operations,
              )
              for (const { key, metadata } of rows) {
                if (
                  metadata !== undefined &&
                  !openTransaction.rowMetadataWrites.has(key)
                ) {
                  openTransaction.rowMetadataWrites.set(key, {
                    type: `set`,
                    value: metadata,
                  })
                }
              }
            },
            applyToCollection: () =>
              applyTransactionToCollection(openTransaction, signal),
            shouldFailStopOnAbort: () => openTransaction.hasDependentSuccessor,
          }
          openTransaction.signal = signal
          pendingPublicationTransactions.push(openTransaction)
          if (
            openTransaction.queuedBecauseHydrating &&
            runtime.isHydratingNow()
          ) {
            let resolveApplied!: () => void
            let rejectApplied!: (error: unknown) => void
            const applied = new Promise<void>((resolve, reject) => {
              resolveApplied = resolve
              rejectApplied = reject
            })
            void applied.catch(() => undefined)
            runtime.queueHydrationBufferedTransaction({
              ...transaction,
              resolveApplied,
              rejectApplied,
            })
            settlePublicationAdmissionWaiters(openTransaction)
            settleRuntimeTransaction(openTransaction, applied)
            return visibleAfterDurable(openTransaction, applied)
          }

          // Admission is complete. Only queued hydration replay remains tied
          // to its sequence; retain hydrationContext for row metadata ownership.
          openTransaction.hydrationSequence = undefined
          let applied: Promise<void>
          try {
            applied = runtime.applyHydrationBufferedTransaction(transaction)
          } catch (error) {
            settlePublicationAdmissionWaiters(openTransaction, error)
            throw error
          }
          settlePublicationAdmissionWaiters(openTransaction)
          settleRuntimeTransaction(openTransaction, applied)
          return visibleAfterDurable(openTransaction, applied)
        },
      }

      // Each invocation of a custom source owns its callbacks. Retiring that
      // invocation before rotation makes late work harmless even when the
      // source does not provide its own restart hook.
      const sourceParamsFor = (session: number) => {
        const active = () =>
          !startupState.cleanedUp && session === sourceSession
        const metadata = wrappedParams.metadata
        return {
          ...wrappedParams,
          markReady: () => {
            if (active()) wrappedParams.markReady()
          },
          markError: (error?: unknown) => {
            if (active()) wrappedParams.markError(error)
          },
          begin: () => {
            if (active()) wrappedParams.begin()
          },
          write: (message: ChangeMessageOrDeleteKeyMessage<T, TKey>) => {
            if (active()) wrappedParams.write(message)
          },
          truncate: () => {
            if (active()) wrappedParams.truncate()
          },
          invalidateLoadedSubsets: () => {
            if (active()) wrappedParams.invalidateLoadedSubsets()
          },
          commit: (signal?: AbortSignal) =>
            active() ? wrappedParams.commit(signal) : true,
          metadata: metadata && {
            ...metadata,
            row: {
              get: (key: TKey) =>
                active() ? metadata.row.get(key) : undefined,
              set: (key: TKey, value: unknown) => {
                if (active()) metadata.row.set(key, value)
              },
              delete: (key: TKey) => {
                if (active()) metadata.row.delete(key)
              },
            },
            collection: {
              get: (key: string) =>
                active() ? metadata.collection.get(key) : undefined,
              set: (key: string, value: unknown) => {
                if (active()) metadata.collection.set(key, value)
              },
              delete: (key: string) => {
                if (active()) metadata.collection.delete(key)
              },
              list: (prefix?: string) =>
                active() ? metadata.collection.list(prefix) : [],
            },
            persistence: {
              ...metadata.persistence,
              reserveCommitTurn: () => {
                if (active()) metadata.persistence.reserveCommitTurn()
              },
              hydrateBaseline: () =>
                active()
                  ? metadata.persistence.hydrateBaseline()
                  : Promise.resolve(),
              startScopedRecovery: (resetMetadata?: {
                key: string
                value: unknown
              }) =>
                active()
                  ? (metadata.persistence.startScopedRecovery?.(
                      resetMetadata,
                    ) ?? Promise.resolve())
                  : Promise.resolve(),
              scanPersistedRows: (
                options?: Parameters<
                  typeof metadata.persistence.scanPersistedRows
                >[0],
              ) =>
                active()
                  ? metadata.persistence.scanPersistedRows(options)
                  : Promise.resolve([]),
              resumeSnapshot: {
                certify: () =>
                  active()
                    ? metadata.persistence.resumeSnapshot.certify()
                    : Promise.resolve(),
                getKeySetEvidence: () =>
                  active()
                    ? metadata.persistence.resumeSnapshot.getKeySetEvidence()
                    : undefined,
                expectCurrentCommit: () => {
                  if (active())
                    metadata.persistence.resumeSnapshot.expectCurrentCommit()
                },
              },
            },
          },
        }
      }

      let sourceResult: SyncConfigRes = {}
      let sourceResultSettled = false
      let activeSourceSyncEntry: Promise<void> | undefined
      let sourceCleanupPromise: Promise<void> | undefined
      let customRestartSequence = 0
      const enterSourceSession = (): void => {
        const session = ++sourceSession
        let settleSourceSyncEntry!: () => void
        activeSourceSyncEntry = new Promise<void>((resolve) => {
          settleSourceSyncEntry = resolve
        })
        try {
          sourceResult = normalizeSyncFnResult(
            sourceSyncConfig.sync(
              runtime.hasManagedCacheGeneration()
                ? sourceParamsFor(session)
                : wrappedParams,
            ),
          )
          // A coordinator acquisition owns the source session that accepted
          // it. A late release must not unload the replacement session.
          if (!startupState.cleanedUp && sourceResult.loadSubset) {
            const ownerSource = sourceResult
            const loadSubset = async (
              options: TransportedLoadSubsetOptions,
            ) => {
              if (startupState.cleanedUp || session !== sourceSession) {
                throw new Error(`persisted sync source is no longer active`)
              }
              await ownerSource.loadSubset?.(
                options as unknown as LoadSubsetOptions,
              )
            }
            runtime.registerRemoteSubsetOwner(
              Object.assign(loadSubset, {
                unloadSubset: (options: TransportedLoadSubsetOptions) =>
                  ownerSource.unloadSubset?.(
                    options as unknown as LoadSubsetOptions,
                  ),
                onError: (error: unknown) => {
                  if (session === sourceSession) reportUpstreamError(error)
                },
              }),
            )
          }
        } finally {
          activeSourceSyncEntry = undefined
          settleSourceSyncEntry()
        }
      }
      const restartCustomSource = (cacheRotated: Promise<void>) => {
        const restartSequence = ++customRestartSequence
        // Synchronous retirement is required by the recovery boundary. Any
        // open old-source transaction is abandoned before the new cache binds.
        if (!sourceCleanupPromise) {
          sourceSession++
          const abortError = new SyncTransactionAbortedError()
          for (const transaction of transactionStack) {
            settlePublicationAdmissionWaiters(transaction, abortError)
          }
          transactionStack.length = 0
          const retiredResult = sourceResult
          sourceCleanupPromise = Promise.resolve().then(() =>
            retiredResult.cleanup?.(),
          )
        }
        return Promise.all([sourceCleanupPromise, cacheRotated]).then(() => {
          if (
            startupState.cleanedUp ||
            restartSequence !== customRestartSequence
          )
            return
          sourceCleanupPromise = undefined
          enterSourceSession()
          runtime.setSourceRestartAfterScopedRecovery(
            sourceResult.restartAfterScopedRecovery ??
              (runtime.hasManagedCacheGeneration()
                ? restartCustomSource
                : undefined),
          )
        })
      }
      fullStartPromise = runtime.ensureStarted()
      // Startup can fail before the source reaches markReady or loadSubset,
      // which are the two eventual consumers of this outer adopting promise.
      // The runtime-owned inner promise still installs and reports the exact
      // terminal failure; this observer only prevents the unused outer wrapper
      // from becoming an unhandled rejection on that fail-stop path.
      void fullStartPromise.catch(() => undefined)
      sourceResultPromise = (async () => {
        await runtime.ensureStartupMetadataLoaded()

        if (startupState.cleanedUp) {
          sourceResultSettled = true
          return sourceResult
        }

        enterSourceSession()
        sourceResultSettled = true
        runtime.setSourceRestartAfterScopedRecovery(
          sourceResult.restartAfterScopedRecovery ??
            (runtime.hasManagedCacheGeneration()
              ? restartCustomSource
              : undefined),
        )
        return sourceResult
      })()
      resolveSourceResultAssigned()
      void sourceResultPromise.catch((error) => {
        reportUpstreamError(error)
      })

      return {
        cleanup: async () => {
          startupState.cleanedUp = true
          runtime.clearSourceRestartAfterScopedRecovery()
          // The optional source starts behind persistence metadata. If it
          // reenters cleanup before returning, wait for that exact synchronous
          // entry to publish its cleanup callback before sampling the result.
          const sourceSyncEntry = activeSourceSyncEntry
          const cleanupError = new SyncTransactionAbortedError()
          for (const acquisition of acquisitions.values()) {
            acquisition.cancelAdmissionWait?.()
          }
          acquisitions.clear()
          pendingPublicationTransactions.length = 0
          for (const transaction of transactionStack) {
            settlePublicationAdmissionWaiters(transaction, cleanupError)
          }
          transactionStack.length = 0
          let sourceCleanup: Promise<void>
          try {
            sourceCleanup =
              sourceCleanupPromise ??
              (sourceSyncEntry
                ? sourceSyncEntry.then(() => sourceResult.cleanup?.())
                : Promise.resolve(sourceResult.cleanup?.()))
          } catch (error) {
            sourceCleanup = Promise.reject(error)
          }
          let runtimeCleanup: Promise<void>
          try {
            runtimeCleanup = runtime.cleanup()
          } catch (error) {
            runtimeCleanup = Promise.reject(error)
          }
          const [sourceOutcome, runtimeOutcome] = await Promise.allSettled([
            sourceCleanup,
            runtimeCleanup,
          ])
          if (
            sourceOutcome.status === `rejected` &&
            runtimeOutcome.status === `rejected`
          ) {
            throw new AggregateError(
              [sourceOutcome.reason, runtimeOutcome.reason],
              `Source cleanup and persistence runtime teardown both failed`,
              { cause: sourceOutcome.reason },
            )
          }
          if (sourceOutcome.status === `rejected`) throw sourceOutcome.reason
          if (runtimeOutcome.status === `rejected`) throw runtimeOutcome.reason
        },
        loadSubset: (options: LoadSubsetOptions): true | Promise<void> => {
          const acquisition: SubsetAcquisition = { forwarded: false }
          acquisitions.set(options, acquisition)
          const forwardUpstream = (
            loadOptions: LoadSubsetOptions,
          ): true | Promise<void> => {
            // Hydration is another async boundary. A release before this
            // point owns no upstream lease and must not start one later.
            if (
              startupState.cleanedUp ||
              acquisitions.get(options) !== acquisition
            ) {
              return true
            }
            const currentSource = sourceResult
            if (!currentSource.loadSubset) return true
            acquisition.forwarded = true
            acquisition.source = currentSource
            try {
              // Returning a promise transfers its lease even if it rejects.
              // Only a synchronous throw leaves no upstream lease to release.
              return currentSource.loadSubset(loadOptions)
            } catch (error) {
              acquisition.forwarded = false
              acquisition.source = undefined
              throw error
            }
          }

          const openTransaction = getOpenTransaction()
          const needsPublicationAdmission =
            openTransaction?.reservesCommitTurn === true
          let hydrationStarted = false
          const raceRetainedLoad = (
            work: Promise<void>,
            canAbortPromptly = () => true,
          ): Promise<void> => {
            const signal = options.signal
            const abortable = !signal
              ? work
              : new Promise<void>((resolve, reject) => {
                  const abortError = () =>
                    signal.reason ?? new SyncTransactionAbortedError()
                  const onAbort = () => {
                    // Once an uncancelable baseline read begins, its returned
                    // load keeps core's overlapping replay private until the
                    // resulting rows and receipts become visible.
                    if (canAbortPromptly()) reject(abortError())
                  }
                  signal.addEventListener(`abort`, onAbort, { once: true })
                  if (signal.aborted) onAbort()
                  void work.then(
                    () => {
                      signal.removeEventListener(`abort`, onAbort)
                      if (signal.aborted) reject(abortError())
                      else resolve()
                    },
                    (error: unknown) => {
                      signal.removeEventListener(`abort`, onAbort)
                      reject(signal.aborted ? abortError() : error)
                    },
                  )
                })
            return abortable.catch((error: unknown) => {
              if (
                startupState.cleanedUp ||
                acquisitions.get(options) !== acquisition
              ) {
                return
              }
              throw error
            })
          }
          const hydrated =
            sourceResultSettled && !needsPublicationAdmission
              ? runtime.loadHydratedSubset(options, (loadOptions) =>
                  forwardUpstream(loadOptions),
                )
              : undefined
          if (hydrated !== undefined) {
            return hydrated === true ? true : raceRetainedLoad(hydrated)
          }

          const work = (async () => {
            await fullStartPromise
            await sourceResultPromise
            if (
              startupState.cleanedUp ||
              acquisitions.get(options) !== acquisition
            ) {
              return
            }
            const currentTransaction = getOpenTransaction()
            // A source transaction that reserved its FIFO turn commits before
            // subset hydration advances the generation it was built against.
            if (currentTransaction?.reservesCommitTurn) {
              await waitForPublicationAdmission(
                currentTransaction,
                options,
                acquisition,
              )
            }
            if (
              options.signal?.aborted ||
              acquisitions.get(options) !== acquisition
            ) {
              return
            }
            return runtime.loadSubset(
              options,
              (loadOptions) => forwardUpstream(loadOptions),
              () => {
                hydrationStarted = true
              },
              () =>
                !startupState.cleanedUp &&
                acquisitions.get(options) === acquisition,
            )
          })()
          return raceRetainedLoad(work, () => !hydrationStarted)
        },
        unloadSubset: (options: LoadSubsetOptions) => {
          const acquisition = acquisitions.get(options)
          acquisition?.cancelAdmissionWait?.()
          acquisitions.delete(options)
          runtime.unloadSubset(
            options,
            acquisition?.forwarded
              ? acquisition.source?.unloadSubset
              : undefined,
          )
        },
      }
    },
  }
}

function createLoopbackSyncConfig<
  T extends object,
  TKey extends string | number,
>(runtime: PersistedCollectionRuntime<T, TKey>): SyncConfig<T, TKey> {
  return {
    sync: (params) => {
      runtime.setCollection(
        params.collection as Collection<T, TKey, PersistedCollectionUtils>,
        {
          begin: params.begin,
          write: params.write as SyncControlFns<T, TKey>[`write`],
          commit: params.commit,
          truncate: params.truncate,
          metadata: params.metadata ?? null,
          markError: params.markError,
        },
      )

      void runtime
        .ensureStarted()
        .then(() => {
          if (runtime.getCurrentTerminalFailure()) return
          params.markReady()
        })
        .catch(() => undefined)

      return {
        loadSubset: (options: LoadSubsetOptions): true | Promise<void> =>
          runtime.loadHydratedSubset(options) ?? runtime.loadSubset(options),
        cleanup: () => runtime.cleanup(),
        unloadSubset: (options: LoadSubsetOptions) =>
          runtime.unloadSubset(options),
      }
    },
    getSyncMetadata: () => ({
      source: `persisted-phase-2-loopback`,
    }),
  }
}

export function persistedCollectionOptions<
  TSchema extends StandardSchemaV1,
  TKey extends string | number,
  TUtils extends UtilsRecord = UtilsRecord,
>(
  options: PersistedSyncWrappedOptions<
    InferSchemaOutput<TSchema>,
    TKey,
    TSchema,
    TUtils
  > & {
    schema: TSchema
  },
): PersistedSyncOptionsResult<
  InferSchemaOutput<TSchema>,
  TKey,
  TSchema,
  TUtils
> & {
  schema: TSchema
}

export function persistedCollectionOptions<
  TSchema extends StandardSchemaV1,
  TKey extends string | number,
  TUtils extends UtilsRecord = UtilsRecord,
>(
  options: PersistedLocalOnlyOptions<
    InferSchemaOutput<TSchema>,
    TKey,
    TSchema,
    TUtils
  > & {
    schema: TSchema
  },
): PersistedLocalOnlyOptionsResult<
  InferSchemaOutput<TSchema>,
  TKey,
  TSchema,
  TUtils
> & {
  schema: TSchema
}

export function persistedCollectionOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
>(
  options: PersistedSyncWrappedOptions<T, TKey, TSchema, TUtils> & {
    schema?: never
  },
): PersistedSyncOptionsResult<T, TKey, never, TUtils>

export function persistedCollectionOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
>(
  options: PersistedLocalOnlyOptions<T, TKey, TSchema, TUtils> & {
    schema?: never
  },
): PersistedLocalOnlyOptionsResult<T, TKey, never, TUtils>

export function persistedCollectionOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
>(
  options:
    | PersistedSyncWrappedOptions<T, TKey, TSchema, TUtils>
    | PersistedLocalOnlyOptions<T, TKey, TSchema, TUtils>,
):
  | PersistedSyncOptionsResult<T, TKey, TSchema, TUtils>
  | PersistedLocalOnlyOptionsResult<T, TKey, TSchema, TUtils> {
  if (!isRecord(options.persistence)) {
    throw new InvalidPersistedCollectionConfigError(
      `persistedCollectionOptions requires a persistence adapter`,
    )
  }

  const networkTimeoutMs = getNetworkTimeoutMs(options.initialRender)
  if (networkTimeoutMs !== undefined && options.syncMode === `on-demand`) {
    throw new InvalidPersistedCollectionConfigError(
      `network-first initial rendering requires eager persistence syncMode`,
    )
  }
  const persistedReadinessTracker =
    networkTimeoutMs !== undefined
      ? new PersistedReadinessTracker(networkTimeoutMs)
      : undefined

  let claimed = false
  let claimedRuntime: PersistedCollectionRuntime<T, TKey> | undefined
  const claimOptions = () => {
    if (claimed) {
      throw new InvalidPersistedCollectionConfigError(
        `Persisted options can create only one Collection. Create fresh options for each Collection.`,
      )
    }
    claimed = true
    return () => {
      if (!claimedRuntime?.hasBoundCollection()) claimed = false
    }
  }

  if (hasOwnSyncKey(options)) {
    if (!isValidSyncConfig(options.sync)) {
      throw new InvalidSyncConfigError(
        `when the "sync" key is present it must provide a callable sync function`,
      )
    }

    const {
      schemaVersion,
      initialRender: _initialRender,
      ...syncOptions
    } = options
    const collectionId =
      syncOptions.id ?? `persisted-collection:${safeRandomUUID()}`
    const persistence = resolvePersistenceForCollection(
      syncOptions.persistence,
      {
        collectionId,
        mode: `sync-present`,
        schemaVersion,
      },
    )

    const runtime = new PersistedCollectionRuntime<T, TKey>(
      `sync-present`,
      collectionId,
      persistence,
      syncOptions.syncMode ?? `eager`,
      collectionId,
      persistedReadinessTracker,
      claimOptions,
    )
    claimedRuntime = runtime

    const result = {
      ...syncOptions,
      id: collectionId,
      sync: createWrappedSyncConfig<T, TKey>(
        syncOptions.sync,
        runtime,
        persistedReadinessTracker,
      ),
      persistence,
      ...(persistedReadinessTracker
        ? { [PERSISTED_READINESS]: persistedReadinessTracker }
        : {}),
    }

    return withCollectionConfigFactory(
      result,
      () =>
        persistedCollectionOptions({
          ...options,
          id: collectionId,
        } as never) as typeof result,
      claimOptions,
    )
  }

  const persistedUtils: PersistedCollectionUtils = {
    acceptMutations: async (transaction) => {
      await runtime.acceptTransactionMutations(transaction)
    },
    getLeadershipState: () => runtime.getLeadershipState(),
    forceReloadSubset: (subsetOptions) =>
      runtime.forceReloadSubset(subsetOptions),
  }
  for (const name of Object.keys(persistedUtils)) {
    if (options.utils && name in options.utils) {
      throw new InvalidPersistedCollectionConfigError(
        `utils.${name} is reserved for local-only persisted Collections`,
      )
    }
  }

  const {
    schemaVersion,
    initialRender: _initialRender,
    ...localOnlyOptions
  } = options
  const collectionId =
    localOnlyOptions.id ?? `persisted-collection:${safeRandomUUID()}`
  const persistence = resolvePersistenceForCollection(
    localOnlyOptions.persistence,
    {
      collectionId,
      mode: `sync-absent`,
      schemaVersion,
    },
  )
  const runtime = new PersistedCollectionRuntime<T, TKey>(
    `sync-absent`,
    collectionId,
    persistence,
    localOnlyOptions.syncMode ?? `eager`,
    localOnlyOptions.id ?? DEFAULT_DB_NAME,
    persistedReadinessTracker,
    claimOptions,
  )
  claimedRuntime = runtime

  const wrappedOnInsert = async (
    params: InsertMutationFnParams<T, TKey, TUtils & PersistedCollectionUtils>,
  ) => {
    const lifecycleGeneration = runtime.getLifecycleGeneration()
    const handlerResult = localOnlyOptions.onInsert
      ? await localOnlyOptions.onInsert(
          params as unknown as InsertMutationFnParams<T, TKey, TUtils>,
        )
      : undefined

    await runtime.persistAndConfirmCollectionMutations(
      params.transaction.mutations as Array<PendingMutation<T>>,
      lifecycleGeneration,
    )

    return handlerResult ?? {}
  }

  const wrappedOnUpdate = async (
    params: UpdateMutationFnParams<T, TKey, TUtils & PersistedCollectionUtils>,
  ) => {
    const lifecycleGeneration = runtime.getLifecycleGeneration()
    const handlerResult = localOnlyOptions.onUpdate
      ? await localOnlyOptions.onUpdate(
          params as unknown as UpdateMutationFnParams<T, TKey, TUtils>,
        )
      : undefined

    await runtime.persistAndConfirmCollectionMutations(
      params.transaction.mutations as Array<PendingMutation<T>>,
      lifecycleGeneration,
    )

    return handlerResult ?? {}
  }

  const wrappedOnDelete = async (
    params: DeleteMutationFnParams<T, TKey, TUtils & PersistedCollectionUtils>,
  ) => {
    const lifecycleGeneration = runtime.getLifecycleGeneration()
    const handlerResult = localOnlyOptions.onDelete
      ? await localOnlyOptions.onDelete(
          params as unknown as DeleteMutationFnParams<T, TKey, TUtils>,
        )
      : undefined

    await runtime.persistAndConfirmCollectionMutations(
      params.transaction.mutations as Array<PendingMutation<T>>,
      lifecycleGeneration,
    )

    return handlerResult ?? {}
  }

  const mergedUtils = {
    ...(localOnlyOptions.utils ?? ({} as TUtils)),
    ...persistedUtils,
  }

  const result = {
    ...localOnlyOptions,
    id: collectionId,
    persistence,
    ...(persistedReadinessTracker
      ? { [PERSISTED_READINESS]: persistedReadinessTracker }
      : {}),
    sync: createLoopbackSyncConfig(runtime),
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils: mergedUtils,
    startSync: true,
    gcTime: localOnlyOptions.gcTime ?? 0,
  }

  return withCollectionConfigFactory(
    result,
    () =>
      persistedCollectionOptions({
        ...options,
        id: collectionId,
      } as never) as typeof result,
    claimOptions,
  )
}

export function encodePersistedStorageKey(key: string | number): string {
  if (typeof key === `number`) {
    if (!Number.isFinite(key)) {
      throw new InvalidPersistedStorageKeyError(key)
    }

    if (Object.is(key, -0)) {
      return `n:-0`
    }

    return `n:${key}`
  }

  return `s:${key}`
}

export function decodePersistedStorageKey(encoded: string): string | number {
  if (encoded === `n:-0`) {
    return -0
  }

  if (encoded.startsWith(`n:`)) {
    return Number(encoded.slice(2))
  }

  if (encoded.startsWith(`s:`)) {
    return encoded.slice(2)
  }

  throw new InvalidPersistedStorageKeyEncodingError(encoded)
}

const PERSISTED_TABLE_NAME_ALPHABET = `abcdefghijklmnopqrstuvwxyz234567`

function hashCollectionId(collectionId: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < collectionId.length; index++) {
    hash ^= collectionId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

function toBase32(input: number): string {
  if (input === 0) {
    return PERSISTED_TABLE_NAME_ALPHABET.charAt(0)
  }

  let value = input >>> 0
  let output = ``

  while (value > 0) {
    output = `${PERSISTED_TABLE_NAME_ALPHABET.charAt(value % 32)}${output}`
    value = Math.floor(value / 32)
  }

  return output
}

export function createPersistedTableName(
  collectionId: string,
  prefix: `c` | `t` = `c`,
): string {
  if (!collectionId) {
    throw new InvalidPersistedCollectionConfigError(
      `collectionId is required to derive a persisted table name`,
    )
  }

  const hashPart = toBase32(hashCollectionId(collectionId))
  const lengthPart = collectionId.length.toString(36)

  return `${prefix}_${hashPart}_${lengthPart}`
}
