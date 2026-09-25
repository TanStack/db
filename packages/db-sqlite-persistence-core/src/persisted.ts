import {
  NoPendingSyncTransactionCommitError,
  NoPendingSyncTransactionWriteError,
  SYNC_PERSISTENCE_PROTOCOL,
  SYNC_PERSISTENCE_VERSION,
  SyncTransactionAbortedError,
  compileSingleRowExpression,
  safeRandomUUID,
  toBooleanPredicate,
  withCollectionConfigFactory,
} from '@tanstack/db'
import {
  DuplicateRemoteSubsetOwnerError,
  InvalidPersistedCollectionConfigError,
  InvalidPersistedCollectionCoordinatorError,
  InvalidPersistedStorageKeyEncodingError,
  InvalidPersistedStorageKeyError,
  InvalidPersistenceAdapterError,
  InvalidSyncConfigError,
  PersistedCollectionDurabilityError,
  toPersistedCollectionDurabilityError,
} from './errors'
import { serializeSQLiteBigInt } from './sqlite-value'
import {
  toProcessLocalLoadSubsetOptions,
  toTransportedLoadSubsetOptions,
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
  | { type: `set`; key: string; value: unknown }
  | { type: `delete`; key: string }

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
    collectionId: string,
    options: LoadSubsetOptions,
    ctx?: { requiredIndexSignatures?: ReadonlyArray<string> },
  ) => Promise<
    Array<{
      key: string | number
      value: Record<string, unknown>
      metadata?: unknown
    }>
  >
  loadResumeSnapshot: (
    collectionId: string,
    ctx?: {
      requiredIndexSignatures?: ReadonlyArray<string>
      includeRows?: boolean
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
  applyCommittedTx: (collectionId: string, tx: PersistedTx) => Promise<void>
  loadCollectionMetadata?: (
    collectionId: string,
  ) => Promise<Array<{ key: string; value: unknown }>>
  scanRows?: (
    collectionId: string,
    options?: PersistedRowScanOptions,
  ) => Promise<Array<PersistedScannedRow>>
  ensureIndex: (
    collectionId: string,
    signature: string,
    spec: PersistedIndexSpec,
  ) => Promise<void>
  markIndexRemoved?: (collectionId: string, signature: string) => Promise<void>
  getStreamPosition?: (collectionId: string) => Promise<{
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
  /** Whether hydration scopes currently enter a shared driver scheduler. */
  isHydrationScopeScheduled?: () => boolean
}

export type HydrationPersistenceAdapter = PersistenceAdapter & {
  pullSince?: (
    collectionId: string,
    fromRowVersion: number,
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
  ) => Promise<void>
  requestApplyLocalMutations?: (
    collectionId: string,
    mutations: Array<PersistedMutationEnvelope>,
  ) => Promise<ApplyLocalMutationsResponse>
  requestApplyCommittedTx: (
    collectionId: string,
    tx: PersistedTx,
    scopedAdapter?: HydrationPersistenceAdapter,
  ) => Promise<ApplyCommittedTxResponse>
  /** The scoped adapter is leader-local and is never serialized to a follower. */
  pullSince?: (
    collectionId: string,
    fromRowVersion: number,
    scopedAdapter?: HydrationPersistenceAdapter,
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

export interface PersistedCollectionUtils extends UtilsRecord {
  acceptMutations: (transaction: {
    mutations: Array<PendingMutation<Record<string, unknown>>>
  }) => Promise<void> | void
  getLeadershipState?: () => PersistedCollectionLeadershipState
  /** Hydrate once without acquiring a new ongoing subset lease. */
  forceReloadSubset?: (options: LoadSubsetOptions) => Promise<void> | void
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
}

export type PersistedLocalOnlyOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
> = Omit<CollectionConfig<T, TKey, TSchema, TUtils>, `sync`> & {
  persistence: PersistedCollectionPersistence
  schemaVersion?: number
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
  begin: ((options?: { immediate?: boolean }) => void) | null
  write:
    | ((
        message:
          | { type: `insert`; value: T; metadata?: Record<string, unknown> }
          | { type: `update`; value: T; metadata?: Record<string, unknown> }
          | { type: `delete`; key: TKey },
      ) => void)
    | null
  commit: ((signal?: AbortSignal) => SyncAppliedReceipt) | null
  truncate: (() => void) | null
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
    try {
      await acquisition.load
    } catch {
      // Calling the owner transferred the lease even when its load rejected.
    }
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
        void (async () => {
          try {
            await acquisition.load
          } catch {
            // Calling the owner transferred the lease even when its load rejected.
          }
          await unloadRemoteSubsetOwner(owner, acquisition.options)
        })().catch(() => undefined)
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
  ): Promise<ApplyCommittedTxResponse> {
    const adapter = this.collectionAdapters.get(collectionId)
    if (!adapter) {
      throw new InvalidPersistedCollectionConfigError(
        `SingleProcessCoordinator has no persistence adapter configured for collection "${collectionId}"`,
      )
    }

    try {
      await adapter.applyCommittedTx(collectionId, tx)
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

type BufferedSyncTransaction<T extends object, TKey extends string | number> = {
  operations: Array<NormalizedSyncOperation<T, TKey>>
  partialUpdateOperationIndexes: Set<number>
  rowMetadataWrites: Map<
    TKey,
    { type: `set`; value: unknown } | { type: `delete` }
  >
  collectionMetadataWrites: Map<
    string,
    { type: `set`; value: unknown } | { type: `delete` }
  >
  deferredHydrationMetadataDeleteKeys: Set<TKey>
  hydrationContext?: { suppliedRowKeys: Set<TKey> }
  hydrationSequence?: number
  truncate: boolean
  internal: boolean
  lifecycleGeneration: number
  beginOptions?: { immediate?: boolean }
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
  hasDependentSuccessor: boolean
  publicationAdmissionWaiters?: Set<{
    resolve: () => void
    reject: (error: unknown) => void
  }>
  terminalFailure?: { error: unknown }
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
    return true
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
  private readonly pendingRemoteSubsetEnsures = new Map<
    string,
    LoadSubsetOptions
  >()
  private readonly queuedHydrationTransactions: Array<
    BufferedSyncTransaction<T, TKey>
  > = []
  private readonly queuedTxCommitted: Array<{
    txCommitted: TxCommitted
    lifecycleGeneration: number
  }> = []
  private readonly requestIds = new WeakMap<LoadSubsetOptions, string>()

  private collection: Collection<T, TKey, PersistedCollectionUtils> | null =
    null
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
  private sourcePublicationWaitDepth = 0
  private appliedReceiptSequence = 0
  private syncErrorReported = false
  private reportedSyncError: unknown
  private readonly pendingAppliedReceipts = new Map<number, Promise<void>>()
  private hydratingGeneration: number | null = null
  private terminalFailure:
    | { lifecycleGeneration: number; error: unknown }
    | undefined
  private coordinatorUnsubscribe: (() => void) | null = null
  private remoteSubsetOwnerUnsubscribe: (() => void) | null = null
  private indexAddedUnsubscribe: (() => void) | null = null
  private indexRemovedUnsubscribe: (() => void) | null = null
  private remoteEnsureRetryTimer: ReturnType<typeof setTimeout> | null = null
  private nextRequestId = 0

  private latestTerm = 0
  private latestSeq = 0
  private latestRowVersion = 0
  private localTerm = 1
  private localSeq = 0
  private localRowVersion = 0

  constructor(
    private readonly mode: PersistedMode,
    private readonly collectionId: string,
    private readonly persistence: PersistedResolvedPersistence,
    private readonly syncMode: `eager` | `on-demand`,
    private readonly dbName: string,
  ) {}

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
    this.remoteSubsetOwnerUnsubscribe =
      this.persistence.coordinator.registerRemoteSubsetOwner(
        this.collectionId,
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

  private async waitForAppliedReceiptsAfter(cursor: number): Promise<void> {
    await Promise.all(
      Array.from(this.pendingAppliedReceipts, ([sequence, receipt]) =>
        sequence > cursor ? receipt : undefined,
      ),
    )
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

  setCollection(
    collection: Collection<T, TKey, PersistedCollectionUtils>,
  ): void {
    if (this.collection === collection) {
      return
    }

    this.collection = collection
    this.attachCoordinatorSubscription()
  }

  getLeadershipState(): PersistedCollectionLeadershipState {
    return {
      nodeId: this.persistence.coordinator.getNodeId(),
      isLeader: this.persistence.coordinator.isLeader(this.collectionId),
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
      const loadStartupMetadata = async (
        adapter: HydrationPersistenceAdapter,
      ) => {
        if (lifecycleGeneration !== this.lifecycleGeneration) {
          resolveStartupMetadata()
          return false
        }

        try {
          await this.loadStartupMetadataInternal(lifecycleGeneration, adapter)
          return lifecycleGeneration === this.lifecycleGeneration
        } catch (error) {
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
      } else {
        // Preserve the existing unscheduled-adapter lifecycle contract: a
        // replacement upstream may start while stale hydration is settling.
        if (await loadStartupMetadata(this.persistence.adapter)) {
          if (this.persistence.adapter.isHydrationScopeScheduled?.()) {
            startup = await this.applyMutex.run(async () => {
              const result = await this.runInHydrationScope((adapter) =>
                this.startInternal(
                  lifecycleGeneration,
                  adapter,
                  resolveStartupMetadata,
                ),
              )
              if (lifecycleGeneration === this.lifecycleGeneration) {
                await this.flushQueuedTxCommittedUnsafe()
              }
              return result
            })
          } else {
            startup = await this.startInternal(
              lifecycleGeneration,
              this.persistence.adapter,
              resolveStartupMetadata,
            )
            if (lifecycleGeneration === this.lifecycleGeneration) {
              await this.flushQueuedTxCommittedUnsafe()
            }
          }
        }
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
          await this.waitForAppliedReceiptsAfter(startup.appliedCursor)
        }
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

      const appliedCursor = await this.applyMutex.run(async () => {
        const result = await this.runInHydrationScope((adapter) =>
          this.hydrateBaseline(lifecycleGeneration, adapter),
        )
        if (lifecycleGeneration === this.lifecycleGeneration) {
          await this.flushQueuedTxCommittedUnsafe()
        }
        return result
      })
      if (
        appliedCursor !== undefined &&
        lifecycleGeneration === this.lifecycleGeneration
      ) {
        await this.waitForAppliedReceiptsAfter(appliedCursor)
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

      const snapshot = await this.persistence.adapter.loadResumeSnapshot(
        this.collectionId,
        {
          requiredIndexSignatures: this.getRequiredIndexSignatures(),
          includeRows: false,
        },
      )
      if (lifecycleGeneration !== this.lifecycleGeneration) return
      this.bindResumeSnapshotEvidence(snapshot)
    })()
    return this.resumeCertificationPromise
  }

  getKeySetEvidence(): PersistedKeySetEvidence | undefined {
    return this.persistedKeySetEvidence
  }

  getResumeGenerationOwner(): symbol {
    return this.resumeGenerationOwner
  }

  private async hydrateBaseline(
    lifecycleGeneration: number,
    adapter: HydrationPersistenceAdapter,
  ): Promise<number | undefined> {
    if (lifecycleGeneration !== this.lifecycleGeneration) return undefined

    const baseline = {}
    this.activeSubsets.set(this.getSubsetKey(baseline), baseline)
    const appliedCursor = this.appliedReceiptSequence
    await this.hydrateSubsetUnsafe(
      baseline,
      {
        requestRemoteEnsure: false,
        lifecycleGeneration,
        bindKeySetEvidence: true,
      },
      adapter,
    )
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

    // Let the source run only once the startup hydrate is about to begin.
    // Its first transaction must bind to that hydrate's sequence, not the
    // sequence before index bootstrap yielded.
    onStartupMetadataLoaded()
    const appliedCursor =
      this.syncMode !== `on-demand`
        ? await this.hydrateBaseline(lifecycleGeneration, adapter)
        : undefined
    return lifecycleGeneration === this.lifecycleGeneration
      ? {
          appliedCursor,
          indexBootstrapSnapshot,
          completedLocalIndexSignatures,
        }
      : undefined
  }

  private async loadStartupMetadataInternal(
    lifecycleGeneration: number,
    adapter: HydrationPersistenceAdapter,
  ): Promise<void> {
    const snapshot = await adapter.loadResumeSnapshot(this.collectionId, {
      includeRows: false,
    })
    if (lifecycleGeneration !== this.lifecycleGeneration) return
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
    if (applied !== true) await applied
  }

  private async loadCollectionMetadataSnapshot(
    adapter: HydrationPersistenceAdapter,
  ): Promise<Array<{ key: string; value: unknown }>> {
    if (!adapter.loadCollectionMetadata) {
      return []
    }

    return adapter.loadCollectionMetadata(this.collectionId)
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

    const nextMetadata = new Map(
      collectionMetadata.map(({ key, value }) => [key, value]),
    )
    const currentKeys = this.syncControls.metadata.collection
      .list()
      .map(({ key }) => key)

    return this.withInternalApply(() => {
      this.syncControls.begin?.({ immediate: true })

      currentKeys.forEach((key) => {
        if (!nextMetadata.has(key)) {
          this.syncControls.metadata?.collection.delete(key)
        }
      })

      nextMetadata.forEach((value, key) => {
        this.syncControls.metadata?.collection.set(key, value)
      })

      return this.syncControls.commit?.() ?? true
    })
  }

  async loadSubset(
    options: LoadSubsetOptions,
    upstreamLoadSubset?: LoadSubsetFn,
  ): Promise<void> {
    this.throwIfTerminal()
    const lifecycleGeneration = this.lifecycleGeneration
    const routeRemoteDemandDuringHydration =
      this.canRouteRemoteDemandThroughCoordinator()
    this.activeSubsets.set(this.getSubsetKey(options), options)
    const appliedCursor = this.appliedReceiptSequence
    try {
      await this.applyMutex.run(async () => {
        await this.runInHydrationScope((adapter) =>
          this.hydrateSubsetUnsafe(
            options,
            {
              requestRemoteEnsure:
                this.mode === `sync-present` &&
                !routeRemoteDemandDuringHydration,
              lifecycleGeneration,
              requestLocalLoadFailure: true,
            },
            adapter,
          ),
        )
        if (lifecycleGeneration === this.lifecycleGeneration) {
          await this.flushQueuedTxCommittedUnsafe()
        }
      })
      if (lifecycleGeneration !== this.lifecycleGeneration) return
      await this.waitForAppliedReceiptsAfter(appliedCursor)
    } catch (error) {
      const subsetKey = this.getSubsetKey(options)
      if (this.activeSubsets.get(subsetKey) === options) {
        this.activeSubsets.delete(subsetKey)
      }
      throw error
    }

    if (
      options.signal?.aborted ||
      this.activeSubsets.get(this.getSubsetKey(options)) !== options
    ) {
      return
    }

    if (this.canRouteRemoteDemandThroughCoordinator()) {
      try {
        await this.persistence.coordinator.requestEnsureRemoteSubset(
          this.collectionId,
          options,
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
      return
    }

    if (upstreamLoadSubset) {
      try {
        await upstreamLoadSubset(options)
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
        console.warn(`Failed to trigger remote subset load:`, error)
        this.queueRemoteSubsetEnsure(options)
        // Hydration remains readable, but it does not satisfy remote demand.
        throw error
      }
    }
  }

  unloadSubset(
    options: LoadSubsetOptions,
    upstreamUnloadSubset?: (options: LoadSubsetOptions) => void,
  ): void {
    const subsetKey = this.getSubsetKey(options)
    this.activeSubsets.delete(subsetKey)
    this.pendingRemoteSubsetEnsures.delete(subsetKey)
    if (this.mode === `sync-present`) {
      void this.persistence.coordinator
        .requestReleaseRemoteSubset(this.collectionId, options)
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
    const lifecycleGeneration = this.lifecycleGeneration
    // A one-shot refresh does not acquire an enduring subscription lease.
    await this.applyMutex.run(async () => {
      await this.runInHydrationScope((adapter) =>
        this.hydrateSubsetUnsafe(
          options,
          {
            requestRemoteEnsure: false,
            lifecycleGeneration,
          },
          adapter,
        ),
      )
      if (lifecycleGeneration === this.lifecycleGeneration) {
        await this.flushQueuedTxCommittedUnsafe()
      }
    })
  }

  queueHydrationBufferedTransaction(
    transaction: BufferedSyncTransaction<T, TKey>,
  ): void {
    const failure = this.getCurrentTerminalFailure()
    if (failure) {
      transaction.rejectApplied?.(failure.error)
      return
    }
    this.queuedHydrationTransactions.push(transaction)
  }

  applyHydrationBufferedTransaction(
    transaction: BufferedSyncTransaction<T, TKey>,
  ): Promise<void> {
    const failure = this.getCurrentTerminalFailure()
    if (failure) return Promise.reject(failure.error)
    if (
      transaction.beginOptions?.immediate &&
      this.sourcePublicationWaitDepth > 0
    ) {
      return Promise.reject(
        new InvalidPersistedCollectionConfigError(
          `immediate persisted source replay cannot enter while an earlier source publication is waiting`,
        ),
      )
    }
    return this.applyMutex.run(async () => {
      await this.applyBufferedSyncTransactionUnsafe(
        transaction,
        this.persistence.adapter,
      )
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

  cleanup(): void {
    this.advanceLifecycle()

    if (this.mode === `sync-present`) {
      for (const options of this.activeSubsets.values()) {
        void this.persistence.coordinator
          .requestReleaseRemoteSubset(this.collectionId, options)
          .catch((error) => {
            this.reportSyncError(error)
          })
      }
    }

    this.coordinatorUnsubscribe?.()
    this.coordinatorUnsubscribe = null

    this.remoteSubsetOwnerUnsubscribe?.()
    this.remoteSubsetOwnerUnsubscribe = null

    this.indexAddedUnsubscribe?.()
    this.indexAddedUnsubscribe = null

    this.indexRemovedUnsubscribe?.()
    this.indexRemovedUnsubscribe = null

    if (this.remoteEnsureRetryTimer !== null) {
      clearTimeout(this.remoteEnsureRetryTimer)
      this.remoteEnsureRetryTimer = null
    }

    this.pendingRemoteSubsetEnsures.clear()
    this.activeSubsets.clear()
    for (const transaction of this.queuedHydrationTransactions) {
      transaction.rejectApplied?.(new SyncTransactionAbortedError())
    }
    this.queuedHydrationTransactions.length = 0
    this.queuedTxCommitted.length = 0
    this.clearSyncControls()
    this.collection = null
  }

  private advanceLifecycle(): void {
    this.lifecycleGeneration++
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
    return adapter.loadSubset(this.collectionId, options, {
      requiredIndexSignatures: this.getRequiredIndexSignatures(),
    }) as Promise<Array<{ key: TKey; value: T; metadata?: unknown }>>
  }

  private async scanPersistedRowsUnsafe(
    options?: PersistedRowScanOptions,
  ): Promise<Array<PersistedScannedRow<T, TKey>>> {
    if (!this.persistence.adapter.scanRows) {
      return []
    }

    return this.persistence.adapter.scanRows(
      this.collectionId,
      options,
    ) as Promise<Array<PersistedScannedRow<T, TKey>>>
  }

  async scanPersistedRows(
    options?: PersistedRowScanOptions,
  ): Promise<Array<PersistedScannedRow<T, TKey>>> {
    this.throwIfTerminal()
    return this.applyMutex.run(() => this.scanPersistedRowsUnsafe(options))
  }

  private async hydrateSubsetUnsafe(
    options: LoadSubsetOptions,
    config: {
      requestRemoteEnsure: boolean
      lifecycleGeneration: number
      bindKeySetEvidence?: boolean
      requestLocalLoadFailure?: boolean
    },
    adapter: HydrationPersistenceAdapter,
  ): Promise<void> {
    let rowsLoaded = false
    let replayFailure: { reason: unknown } | undefined
    this.hydrationSequence++
    const hydrationContext = { suppliedRowKeys: new Set<TKey>() }
    this.activeHydrationContext = hydrationContext
    try {
      this.throwIfTerminal()
      this.hydratingGeneration = config.lifecycleGeneration
      try {
        let rows: Array<{ key: TKey; value: T; metadata?: unknown }>
        if (config.bindKeySetEvidence) {
          const snapshot = await adapter.loadResumeSnapshot(this.collectionId, {
            requiredIndexSignatures: this.getRequiredIndexSignatures(),
            includeRows: true,
          })
          rows = snapshot.rows as Array<{
            key: TKey
            value: T
            metadata?: unknown
          }>
          if (config.lifecycleGeneration !== this.lifecycleGeneration) return
          this.bindResumeSnapshotEvidence(snapshot)
        } else {
          rows = await this.loadSubsetRowsUnsafe(options, adapter)
        }
        rowsLoaded = true
        if (config.lifecycleGeneration !== this.lifecycleGeneration) return

        if (
          !config.bindKeySetEvidence ||
          this.persistedKeySetEvidence?.status !== `incompatible`
        ) {
          for (const row of rows) {
            hydrationContext.suppliedRowKeys.add(row.key)
          }
          const applied = this.applyRowsToCollection(rows)
          if (applied !== true) await applied
        }
      } finally {
        if (this.hydratingGeneration === config.lifecycleGeneration) {
          this.hydratingGeneration = null
        }
      }

      if (config.lifecycleGeneration !== this.lifecycleGeneration) return
      replayFailure = await this.flushQueuedHydrationTransactionsUnsafe(adapter)
      if (config.lifecycleGeneration !== this.lifecycleGeneration) return
      await this.flushQueuedTxCommittedUnsafe()

      if (config.requestRemoteEnsure && !replayFailure) {
        this.queueRemoteSubsetEnsure(options)
      }
    } catch (error) {
      if (config.requestLocalLoadFailure && !rowsLoaded) {
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
        if (config.lifecycleGeneration === this.lifecycleGeneration) {
          await this.flushQueuedTxCommittedUnsafe()
        }
        throw error
      }
      throw this.markTerminalFailure(error, config.lifecycleGeneration)
    } finally {
      if (this.activeHydrationContext === hydrationContext) {
        this.activeHydrationContext = undefined
      }
    }
    if (replayFailure) throw replayFailure.reason
  }

  private async recoverBufferedTransactionsAfterLocalLoadFailureUnsafe(
    lifecycleGeneration: number,
    adapter: HydrationPersistenceAdapter,
  ): Promise<void> {
    let snapshotRows:
      | Map<TKey, { key: TKey; value: T; metadata?: unknown }>
      | undefined
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
                const snapshot = await adapter.loadResumeSnapshot(
                  this.collectionId,
                  {
                    requiredIndexSignatures: this.getRequiredIndexSignatures(),
                    includeRows: true,
                  },
                )
                this.throwIfLifecycleReplaced(lifecycleGeneration)
                if (transaction.signal?.aborted) break
                snapshotRows = new Map(
                  (
                    snapshot.rows as Array<{
                      key: TKey
                      value: T
                      metadata?: unknown
                    }>
                  ).map((row) => [row.key, row]),
                )
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
  ): SyncAppliedReceipt {
    if (
      !this.syncControls.begin ||
      !this.syncControls.write ||
      !this.syncControls.commit
    ) {
      return true
    }

    return this.withInternalApply(() => {
      this.syncControls.begin?.({ immediate: true })

      for (const row of rows) {
        if (this.collection?._hasHydratedKey(row.key)) {
          continue
        }
        this.syncControls.write?.({
          type: `update`,
          value: row.value,
          metadata: row.metadata as Record<string, unknown> | undefined,
        })
      }

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
      expected.latestTerm === generation.latestTerm &&
      expected.latestSeq === generation.latestSeq &&
      expected.latestRowVersion === generation.latestRowVersion &&
      expected.resetEpoch === generation.resetEpoch
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
  ): SyncAppliedReceipt {
    if (
      !this.syncControls.begin ||
      !this.syncControls.write ||
      !this.syncControls.commit ||
      !this.syncControls.metadata
    ) {
      return true
    }

    const nextMetadata = new Map(
      collectionMetadata.map(({ key, value }) => [key, value]),
    )
    const currentKeys = this.syncControls.metadata.collection
      .list()
      .map(({ key }) => key)

    return this.withInternalApply(() => {
      this.syncControls.begin?.({ immediate: true })
      this.syncControls.truncate?.()

      for (const row of rows) {
        this.syncControls.write?.({
          type: `update`,
          value: row.value,
          metadata: row.metadata as Record<string, unknown> | undefined,
        })
      }

      currentKeys.forEach((key) => {
        if (!nextMetadata.has(key)) {
          this.syncControls.metadata?.collection.delete(key)
        }
      })

      nextMetadata.forEach((value, key) => {
        this.syncControls.metadata?.collection.set(key, value)
      })

      return this.syncControls.commit?.() ?? true
    })
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
    adapter: HydrationPersistenceAdapter,
  ): Promise<{
    applied: boolean
    hydrationFailure?: { reason: unknown }
  }> {
    this.throwIfTerminal()
    this.throwIfLifecycleReplaced(transaction.lifecycleGeneration)
    const abortedBeforeApplication = transaction.signal?.aborted === true
    let abortedDuringApplication = false
    let applicationReturned = false

    try {
      const applied = transaction.internal
        ? this.withInternalApply(transaction.applyToCollection)
        : transaction.applyToCollection()
      applicationReturned = true
      abortedDuringApplication = transaction.signal?.aborted === true
      if (applied !== true) {
        this.sourcePublicationWaitDepth++
        try {
          await applied
        } finally {
          this.sourcePublicationWaitDepth--
        }
      }
      this.throwIfLifecycleReplaced(transaction.lifecycleGeneration)

      if (!transaction.internal) {
        await this.persistAndBroadcastExternalSyncTransactionUnsafe(
          transaction,
          adapter,
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
    adapter: HydrationPersistenceAdapter = this.persistence.adapter,
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

    const streamPosition = this.nextLocalStreamPosition()
    const tx = this.createPersistedTxFromOperations(transaction, streamPosition)
    const response = await this.persistence.coordinator.requestApplyCommittedTx(
      this.collectionId,
      tx,
      adapter,
    )
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
    if (transaction.lifecycleGeneration !== this.lifecycleGeneration) return
    this.observeStreamPosition(
      response.term,
      response.seq,
      response.latestRowVersion,
    )
    if (
      transaction.expectedResumeGenerationOwner ===
        this.resumeGenerationOwner &&
      this.persistedResumeGeneration !== undefined
    ) {
      this.persistedResumeGeneration = {
        ...this.persistedResumeGeneration,
        latestTerm: response.term,
        latestSeq: response.seq,
        latestRowVersion: response.latestRowVersion,
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
      await this.persistence.adapter.applyCommittedTx(this.collectionId, tx)
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
      rowMetadataMutations: Array.from(
        transaction.rowMetadataWrites.entries(),
      ).map(([key, metadataWrite]) =>
        metadataWrite.type === `delete`
          ? { type: `delete` as const, key: key }
          : {
              type: `set` as const,
              key: key,
              value: metadataWrite.value,
            },
      ),
      collectionMetadataMutations: Array.from(
        transaction.collectionMetadataWrites.entries(),
      ).map(([key, metadataWrite]) =>
        metadataWrite.type === `delete`
          ? { type: `delete`, key }
          : { type: `set`, key, value: metadataWrite.value },
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
      this.syncControls.begin?.({ immediate: true })

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

    if (applied !== true) {
      await applied
    }
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
      const envelopeMutations = mutations.map((mutation) =>
        toPersistedMutationEnvelope(
          mutation as unknown as PendingMutation<Record<string, unknown>>,
        ),
      )

      const response =
        await this.persistence.coordinator.requestApplyLocalMutations(
          this.collectionId,
          envelopeMutations,
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

      this.observeStreamPosition(
        response.term,
        response.seq,
        response.latestRowVersion,
      )

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
      collectionId: this.collectionId,
      senderId: this.persistence.coordinator.getNodeId(),
      ts: Date.now(),
      payload: txCommitted,
    }
    this.persistence.coordinator.publish(this.collectionId, envelope)
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
      !this.persistence.coordinator.isLeader(this.collectionId) ||
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
          this.collectionId,
          options,
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

    this.coordinatorUnsubscribe = this.persistence.coordinator.subscribe(
      this.collectionId,
      (message) => {
        this.onCoordinatorMessage(message)
      },
    )
  }

  private onCoordinatorMessage(message: ProtocolEnvelope<unknown>): void {
    if (message.collectionId !== this.collectionId) {
      return
    }
    if (this.getCurrentTerminalFailure()) {
      return
    }

    const { payload } = message
    const lifecycleGeneration = this.lifecycleGeneration
    const isSelf = message.senderId === this.persistence.coordinator.getNodeId()

    // Allow tx:committed from self — the coordinator produces these on behalf
    // of both local and remote mutations. The seq dedup in
    // processCommittedTxUnsafe prevents double-processing of our own writes.
    if (isTxCommittedPayload(payload)) {
      if (this.isHydratingNow()) {
        this.queuedTxCommitted.push({
          txCommitted: payload,
          lifecycleGeneration,
        })
        return
      }

      void this.applyMutex
        .run(() => this.processCommittedTxUnsafe(payload, lifecycleGeneration))
        .catch((error) => {
          this.markTerminalFailure(error, lifecycleGeneration)
        })
      return
    }

    // Skip remaining message types from self (e.g. heartbeats, resets)
    if (isSelf) {
      return
    }

    if (isCollectionResetPayload(payload)) {
      void this.applyMutex
        .run(async () => {
          await this.runInHydrationScope((adapter) =>
            this.truncateAndReloadUnsafe(adapter, lifecycleGeneration),
          )
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
      const queued = this.queuedTxCommitted.shift()
      if (!queued) {
        continue
      }
      await this.processCommittedTxUnsafe(
        queued.txCommitted,
        queued.lifecycleGeneration,
      )
    }
  }

  private async processCommittedTxUnsafe(
    txCommitted: TxCommitted,
    lifecycleGeneration = this.lifecycleGeneration,
  ): Promise<void> {
    if (lifecycleGeneration !== this.lifecycleGeneration) return
    if (txCommitted.term < this.latestTerm) {
      return
    }

    if (
      txCommitted.term === this.latestTerm &&
      txCommitted.seq <= this.latestSeq
    ) {
      return
    }

    const hasGapInCurrentTerm =
      txCommitted.term === this.latestTerm &&
      txCommitted.seq > this.latestSeq + 1
    const hasGapAcrossTerms =
      txCommitted.term > this.latestTerm && txCommitted.seq > 1
    const hasGap = hasGapInCurrentTerm || hasGapAcrossTerms

    if (hasGap) {
      await this.recoverFromSeqGapUnsafe(lifecycleGeneration)
      if (lifecycleGeneration !== this.lifecycleGeneration) return
      if (
        txCommitted.term < this.latestTerm ||
        (txCommitted.term === this.latestTerm &&
          txCommitted.seq <= this.latestSeq)
      ) {
        return
      }
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
      await this.flushQueuedTxCommittedUnsafe()
    }
  }

  private async recoverFromSeqGapUnsafe(
    lifecycleGeneration: number,
  ): Promise<void> {
    if (lifecycleGeneration !== this.lifecycleGeneration) return
    if (this.persistence.coordinator.pullSince && this.latestRowVersion >= 0) {
      let pullResponse: PullSinceResponse | undefined
      try {
        pullResponse = await this.persistence.coordinator.pullSince(
          this.collectionId,
          this.latestRowVersion,
        )
      } catch (error) {
        console.warn(`Failed pullSince recovery attempt:`, error)
      }

      if (pullResponse) {
        if (lifecycleGeneration !== this.lifecycleGeneration) return

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
            return
          }
          const deltas = pullResponse.deltas
          if (!deltas) {
            await this.runInHydrationScope((adapter) =>
              this.reloadActiveSubsetsUnsafe(adapter),
            )
            return
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
          return
        }
      }
    }

    if (lifecycleGeneration !== this.lifecycleGeneration) return
    await this.runInHydrationScope((adapter) =>
      this.truncateAndReloadUnsafe(adapter, lifecycleGeneration),
    )

    if (this.mode === `sync-present`) {
      for (const options of this.activeSubsets.values()) {
        this.queueRemoteSubsetEnsure(options)
      }
    }
  }

  private async truncateAndReloadUnsafe(
    adapter: HydrationPersistenceAdapter,
    lifecycleGeneration = this.lifecycleGeneration,
  ): Promise<void> {
    if (lifecycleGeneration !== this.lifecycleGeneration) return
    if (this.syncControls.begin && this.syncControls.commit) {
      const applied = this.withInternalApply(() => {
        this.syncControls.begin?.({ immediate: true })
        this.syncControls.truncate?.()
        return this.syncControls.commit?.() ?? true
      })
      if (applied !== true) await applied
    }

    if (lifecycleGeneration !== this.lifecycleGeneration) return
    await this.reloadActiveSubsetsUnsafe(adapter)
  }

  private async invalidateFromCommittedTxUnsafe(
    txCommitted: TxCommitted,
    adapter: HydrationPersistenceAdapter,
  ): Promise<void> {
    const reloadActiveSubsets = () =>
      this.runInHydrationScope(
        (scopedAdapter) => this.reloadActiveSubsetsUnsafe(scopedAdapter),
        adapter,
      )

    if (txCommitted.requiresFullReload) {
      await reloadActiveSubsets()
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
      this.syncControls.begin?.({ immediate: true })

      for (const {
        key: changedKey,
        value: newValue,
      } of txCommitted.changedRows) {
        const matchesAnySubset = subsetEvaluators.some((evaluator) => {
          if (!evaluator) return true
          return toBooleanPredicate(evaluator(newValue) as boolean | null)
        })

        if (matchesAnySubset) {
          this.syncControls.write?.({ type: `update`, value: newValue as T })
        } else if (this.collection?.get(changedKey as TKey) !== undefined) {
          this.syncControls.write?.({ type: `delete`, key: changedKey as TKey })
        }
      }

      for (const deletedKey of txCommitted.deletedKeys) {
        this.syncControls.write?.({ type: `delete`, key: deletedKey as TKey })
      }

      txCommitted.rowMetadataMutations?.forEach((mutation) => {
        if (mutation.type === `delete`) {
          this.syncControls.metadata?.row.delete(mutation.key as TKey)
        } else {
          this.syncControls.metadata?.row.set(
            mutation.key as TKey,
            mutation.value,
          )
        }
      })

      txCommitted.collectionMetadataMutations?.forEach((mutation) => {
        if (mutation.type === `delete`) {
          this.syncControls.metadata?.collection.delete(mutation.key)
        } else {
          this.syncControls.metadata?.collection.set(
            mutation.key,
            mutation.value,
          )
        }
      })

      return this.syncControls.commit?.() ?? true
    })
    if (applied !== true) await applied
  }

  private async reloadActiveSubsetsUnsafe(
    adapter: HydrationPersistenceAdapter,
  ): Promise<void> {
    const lifecycleGeneration = this.lifecycleGeneration
    const activeSubsetOptions =
      this.activeSubsets.size > 0
        ? Array.from(this.activeSubsets.values())
        : [{}]

    this.hydrationSequence++
    const hydrationContext = { suppliedRowKeys: new Set<TKey>() }
    this.activeHydrationContext = hydrationContext
    this.hydratingGeneration = lifecycleGeneration
    try {
      const mergedRows = new Map<TKey, { value: T; metadata?: unknown }>()
      const collectionMetadata =
        await this.loadCollectionMetadataSnapshot(adapter)
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

      for (const key of mergedRows.keys()) {
        hydrationContext.suppliedRowKeys.add(key)
      }

      const applied = this.replaceCollectionSnapshot(
        Array.from(mergedRows.entries()).map(([key, row]) => ({
          key,
          value: row.value,
          metadata: row.metadata,
        })),
        collectionMetadata,
      )
      if (applied !== true) await applied
    } finally {
      if (this.hydratingGeneration === lifecycleGeneration) {
        this.hydratingGeneration = null
      }
      if (this.activeHydrationContext === hydrationContext) {
        this.activeHydrationContext = undefined
      }
    }

    if (lifecycleGeneration === this.lifecycleGeneration) {
      await this.flushQueuedHydrationTransactionsUnsafe(adapter)
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
      void this.ensurePersistedIndex(event.index)
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
    for (const metadata of indexMetadata) {
      if (await this.ensureLocalPersistedIndex(metadata, adapter)) {
        completedLocalIndexSignatures.add(metadata.signature)
      }
    }
    return completedLocalIndexSignatures
  }

  private async requestCoordinatorPersistedIndexes(
    indexMetadata: Array<CollectionIndexMetadata>,
    completedLocalIndexSignatures: ReadonlySet<string>,
  ): Promise<void> {
    for (const metadata of indexMetadata) {
      await this.requestCoordinatorPersistedIndex(
        metadata,
        completedLocalIndexSignatures.has(metadata.signature),
      )
    }
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
    const completedLocally = await this.ensureLocalPersistedIndex(
      indexMetadata,
      adapter,
    )
    await this.requestCoordinatorPersistedIndex(indexMetadata, completedLocally)
  }

  private async ensureLocalPersistedIndex(
    indexMetadata: CollectionIndexMetadata,
    adapter: HydrationPersistenceAdapter,
  ): Promise<boolean> {
    const spec = this.buildPersistedIndexSpec(indexMetadata)

    try {
      await adapter.ensureIndex(
        this.collectionId,
        indexMetadata.signature,
        spec,
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
    const spec = this.buildPersistedIndexSpec(indexMetadata)

    try {
      await this.persistence.coordinator.requestEnsurePersistedIndex(
        this.collectionId,
        indexMetadata.signature,
        spec,
        completedLocally ? this.persistence.adapter : undefined,
        completedLocally,
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
      await this.persistence.adapter.markIndexRemoved(
        this.collectionId,
        indexMetadata.signature,
      )
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
        if (index !== -1) pendingPublicationTransactions.splice(index, 1)
      }
      const settlePendingTransaction = (
        transaction: OpenSyncTransaction<T, TKey>,
      ) => {
        removePendingPublicationTransaction(transaction)
      }
      const settleRuntimeTransaction = (
        transaction: OpenSyncTransaction<T, TKey>,
        applied: Promise<void>,
      ) => {
        void applied.then(
          () => settlePendingTransaction(transaction),
          () => {
            settlePendingTransaction(transaction)
          },
        )
      }
      const getPendingRowMetadataWrite = (key: TKey) => {
        for (
          let index = pendingPublicationTransactions.length - 1;
          index >= 0;
          index--
        ) {
          const transaction = pendingPublicationTransactions[index]!
          const write = transaction.rowMetadataWrites.get(key)
          if (write) {
            markPendingMetadataDependency(transaction)
            return { found: true, write }
          }
          if (transaction.truncate) {
            markPendingMetadataDependency(transaction)
            return {
              found: true,
              write: { type: `delete` as const },
            }
          }
        }
        return { found: false as const }
      }
      const getPendingCollectionMetadataWrite = (key: string) => {
        for (
          let index = pendingPublicationTransactions.length - 1;
          index >= 0;
          index--
        ) {
          const transaction = pendingPublicationTransactions[index]!
          const write = transaction.collectionMetadataWrites.get(key)
          if (write) {
            markPendingMetadataDependency(transaction)
            return { found: true, write }
          }
        }
        return { found: false as const }
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

          // A buffered source replay is part of the hydrate that owns it.
          // It must not wait for a mutation whose persistence is queued
          // behind that hydrate's apply mutex.
          params.begin(
            transaction.queuedBecauseHydrating
              ? { immediate: true }
              : transaction.beginOptions,
          )
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
              if (write.type === `delete`) params.metadata.row.delete(key)
              else params.metadata.row.set(key, write.value)
            }
            for (const [key, write] of transaction.collectionMetadataWrites) {
              if (write.type === `delete`)
                params.metadata.collection.delete(key)
              else params.metadata.collection.set(key, write.value)
            }
          }

          const applied = params.commit(signal)
          transaction.applicationReceipt = applied
          if (applied === true) {
            removePendingPublicationTransaction(transaction)
          } else {
            void applied.then(
              () => removePendingPublicationTransaction(transaction),
              () => removePendingPublicationTransaction(transaction),
            )
          }
          return applied
        } catch (error) {
          removePendingPublicationTransaction(transaction)
          throw error
        }
      }
      runtime.setSyncControls({
        begin: params.begin,
        write: params.write as SyncControlFns<T, TKey>[`write`],
        commit: params.commit,
        truncate: params.truncate,
        metadata: params.metadata ?? null,
        markError: params.markError,
      })
      runtime.setCollection(
        params.collection as Collection<T, TKey, PersistedCollectionUtils>,
      )

      const persistenceCapability: SyncPersistenceCapabilityV1<TKey> = {
        protocol: SYNC_PERSISTENCE_PROTOCOL,
        version: SYNC_PERSISTENCE_VERSION,
        hydrateBaseline: async () => {
          if (startupState.cleanedUp) return
          try {
            await runtime.ensureResumeBaselineHydrated()
          } catch (error) {
            throw runtime.reportSyncError(error)
          }
        },
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

      const wrappedParams = {
        ...params,
        markReady: () => {
          if (startupState.cleanedUp || getTerminalFailure()) return
          void (fullStartPromise ?? runtime.ensureStarted())
            .then(async () => {
              if (isCleanedUp() || getTerminalFailure()) return
              await sourceResultAssigned
              try {
                await sourceResultPromise
              } catch (error) {
                runtime.reportSyncError(error)
                return
              }
              if (isCleanedUp() || getTerminalFailure()) return
              params.markReady()
            })
            .catch(() => undefined)
        },
        begin: (options?: { immediate?: boolean }) => {
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
            beginOptions: options,
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
                get: (key: TKey) => {
                  if (startupState.cleanedUp) return undefined
                  const openTransaction = getOpenTransaction()
                  const pendingWrite =
                    openTransaction?.rowMetadataWrites.get(key)
                  if (pendingWrite) {
                    return pendingWrite.type === `delete`
                      ? undefined
                      : pendingWrite.value
                  }
                  if (openTransaction?.truncate) {
                    return undefined
                  }
                  const pending = getPendingRowMetadataWrite(key)
                  if (pending.found) {
                    return pending.write.type === `delete`
                      ? undefined
                      : pending.write.value
                  }
                  return params.metadata!.row.get(key)
                },
                set: (key: TKey, value: unknown) => {
                  if (startupState.cleanedUp) return
                  const openTransaction = getOpenTransaction()
                  if (openTransaction?.terminalFailure ?? getTerminalFailure())
                    return
                  if (!openTransaction) {
                    throw new InvalidPersistedCollectionConfigError(
                      `metadata.row.set must be called within an open sync transaction`,
                    )
                  }
                  openTransaction.rowMetadataWrites.set(key, {
                    type: `set`,
                    value,
                  })
                },
                delete: (key: TKey) => {
                  if (startupState.cleanedUp) return
                  const openTransaction = getOpenTransaction()
                  if (openTransaction?.terminalFailure ?? getTerminalFailure())
                    return
                  if (!openTransaction) {
                    throw new InvalidPersistedCollectionConfigError(
                      `metadata.row.delete must be called within an open sync transaction`,
                    )
                  }
                  openTransaction.rowMetadataWrites.set(key, {
                    type: `delete`,
                  })
                },
              },
              collection: {
                get: (key: string) => {
                  if (startupState.cleanedUp) return undefined
                  const openTransaction = getOpenTransaction()
                  const pendingWrite =
                    openTransaction?.collectionMetadataWrites.get(key)
                  if (pendingWrite) {
                    return pendingWrite.type === `delete`
                      ? undefined
                      : pendingWrite.value
                  }
                  const pending = getPendingCollectionMetadataWrite(key)
                  if (pending.found) {
                    return pending.write.type === `delete`
                      ? undefined
                      : pending.write.value
                  }
                  return params.metadata!.collection.get(key)
                },
                set: (key: string, value: unknown) => {
                  if (startupState.cleanedUp) return
                  const openTransaction = getOpenTransaction()
                  if (openTransaction?.terminalFailure ?? getTerminalFailure())
                    return
                  if (!openTransaction) {
                    throw new InvalidPersistedCollectionConfigError(
                      `metadata.collection.set must be called within an open sync transaction`,
                    )
                  }
                  openTransaction.collectionMetadataWrites.set(key, {
                    type: `set`,
                    value,
                  })
                },
                delete: (key: string) => {
                  if (startupState.cleanedUp) return
                  const openTransaction = getOpenTransaction()
                  if (openTransaction?.terminalFailure ?? getTerminalFailure())
                    return
                  if (!openTransaction) {
                    throw new InvalidPersistedCollectionConfigError(
                      `metadata.collection.delete must be called within an open sync transaction`,
                    )
                  }
                  openTransaction.collectionMetadataWrites.set(key, {
                    type: `delete`,
                  })
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
                      if (metadataWrite.type === `delete`) {
                        merged.delete(key)
                      } else {
                        merged.set(key, metadataWrite.value)
                      }
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
                      if (metadataWrite.type === `delete`) {
                        merged.delete(key)
                      } else {
                        merged.set(key, metadataWrite.value)
                      }
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
              settlePendingTransaction(openTransaction)
              settlePublicationAdmissionWaiters(
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
            settlePendingTransaction(openTransaction)
            const error = new SyncTransactionAbortedError()
            settlePublicationAdmissionWaiters(openTransaction, error)
            return createHandledRejection(error)
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
            beginOptions: openTransaction.beginOptions,
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
            return applied
          }

          let applied: Promise<void>
          try {
            applied = runtime.applyHydrationBufferedTransaction(transaction)
          } catch (error) {
            settlePublicationAdmissionWaiters(openTransaction, error)
            throw error
          }
          settlePublicationAdmissionWaiters(openTransaction)
          settleRuntimeTransaction(openTransaction, applied)
          return applied
        },
      }

      let sourceResult: SyncConfigRes = {}
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
          return sourceResult
        }

        sourceResult = normalizeSyncFnResult(
          sourceSyncConfig.sync(wrappedParams),
        )
        if (sourceResult.loadSubset) {
          const loadSubset = async (options: TransportedLoadSubsetOptions) => {
            if (startupState.cleanedUp) {
              throw new Error(`persisted sync source is no longer active`)
            }
            await sourceResult.loadSubset?.(
              options as unknown as LoadSubsetOptions,
            )
          }
          runtime.registerRemoteSubsetOwner(
            Object.assign(loadSubset, {
              unloadSubset: (options: TransportedLoadSubsetOptions) =>
                sourceResult.unloadSubset?.(
                  options as unknown as LoadSubsetOptions,
                ),
              onError: (error: unknown) => runtime.reportSyncError(error),
            }),
          )
        }
        return sourceResult
      })()
      resolveSourceResultAssigned()
      void sourceResultPromise.catch((error) => {
        runtime.reportSyncError(error)
      })

      return {
        cleanup: () => {
          startupState.cleanedUp = true
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
          sourceResult.cleanup?.()
          runtime.cleanup()
        },
        loadSubset: async (options: LoadSubsetOptions) => {
          const acquisition = { forwarded: false }
          acquisitions.set(options, acquisition)
          await fullStartPromise
          const resolvedSourceResult = await sourceResultPromise
          if (
            startupState.cleanedUp ||
            acquisitions.get(options) !== acquisition
          ) {
            return
          }
          const openTransaction = getOpenTransaction()
          // Electric can keep one immediate source transaction open across
          // callbacks. Let that transaction reserve its FIFO turn before a
          // subset hydration advances the generation it was built against.
          if (
            openTransaction &&
            !openTransaction.internal &&
            openTransaction.beginOptions?.immediate
          ) {
            await waitForPublicationAdmission(
              openTransaction,
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
          return runtime.loadSubset(options, (loadOptions) => {
            // Hydration is another async boundary. A release before this
            // point owns no upstream lease and must not start one later.
            if (
              startupState.cleanedUp ||
              acquisitions.get(options) !== acquisition
            ) {
              return true
            }
            if (!resolvedSourceResult.loadSubset) return true
            acquisition.forwarded = true
            try {
              // Returning a promise transfers its lease even if it rejects.
              // Only a synchronous throw leaves no upstream lease to release.
              return resolvedSourceResult.loadSubset(loadOptions)
            } catch (error) {
              acquisition.forwarded = false
              throw error
            }
          })
        },
        unloadSubset: (options: LoadSubsetOptions) => {
          const acquisition = acquisitions.get(options)
          acquisition?.cancelAdmissionWait?.()
          acquisitions.delete(options)
          runtime.unloadSubset(
            options,
            acquisition?.forwarded ? sourceResult.unloadSubset : undefined,
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
      runtime.setSyncControls({
        begin: params.begin,
        write: params.write as SyncControlFns<T, TKey>[`write`],
        commit: params.commit,
        truncate: params.truncate,
        metadata: params.metadata ?? null,
        markError: params.markError,
      })
      runtime.setCollection(
        params.collection as Collection<T, TKey, PersistedCollectionUtils>,
      )

      void runtime
        .ensureStarted()
        .then(() => {
          if (runtime.getCurrentTerminalFailure()) return
          params.markReady()
        })
        .catch(() => undefined)

      return {
        cleanup: () => {
          runtime.cleanup()
        },
        loadSubset: (options: LoadSubsetOptions) => runtime.loadSubset(options),
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
): PersistedSyncOptionsResult<T, TKey, TSchema, TUtils>

export function persistedCollectionOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
>(
  options: PersistedLocalOnlyOptions<T, TKey, TSchema, TUtils> & {
    schema?: never
  },
): PersistedLocalOnlyOptionsResult<T, TKey, TSchema, TUtils>

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

  if (hasOwnSyncKey(options)) {
    if (!isValidSyncConfig(options.sync)) {
      throw new InvalidSyncConfigError(
        `when the "sync" key is present it must provide a callable sync function`,
      )
    }

    const { schemaVersion, ...syncOptions } = options
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
    )

    const result = {
      ...syncOptions,
      id: collectionId,
      sync: createWrappedSyncConfig<T, TKey>(syncOptions.sync, runtime),
      persistence,
    }

    return withCollectionConfigFactory(
      result,
      () =>
        persistedCollectionOptions({
          ...options,
          id: collectionId,
        } as never) as typeof result,
    )
  }

  const { schemaVersion, ...localOnlyOptions } = options
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
  )

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

  const acceptMutations = async (transaction: {
    mutations: Array<PendingMutation<Record<string, unknown>>>
  }) => {
    await runtime.acceptTransactionMutations(transaction)
  }

  const persistedUtils: PersistedCollectionUtils = {
    acceptMutations,
    getLeadershipState: () => runtime.getLeadershipState(),
    forceReloadSubset: (subsetOptions: LoadSubsetOptions) =>
      runtime.forceReloadSubset(subsetOptions),
  }

  const mergedUtils = {
    ...(localOnlyOptions.utils ?? ({} as TUtils)),
    ...persistedUtils,
  }

  const result = {
    ...localOnlyOptions,
    id: collectionId,
    persistence,
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
