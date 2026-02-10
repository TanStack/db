import {
  InvalidPersistedCollectionConfigError,
  InvalidPersistedCollectionCoordinatorError,
  InvalidPersistedStorageKeyEncodingError,
  InvalidPersistedStorageKeyError,
  InvalidPersistenceAdapterError,
  InvalidSyncConfigError,
} from './errors'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  ChangeMessageOrDeleteKeyMessage,
  Collection,
  CollectionConfig,
  CollectionIndexMetadata,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  LoadSubsetOptions,
  PendingMutation,
  SyncConfig,
  SyncConfigRes,
  UpdateMutationFnParams,
  UtilsRecord,
} from '@tanstack/db'

export type PersistedMutationEnvelope =
  | {
      mutationId: string
      type: `insert`
      key: string | number
      value: Record<string, unknown>
    }
  | {
      mutationId: string
      type: `update`
      key: string | number
      value: Record<string, unknown>
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
      changedKeys: Array<string | number>
      deletedKeys: Array<string | number>
    }
)

export type EnsureRemoteSubsetRequest = {
  type: `rpc:ensureRemoteSubset:req`
  rpcId: string
  options: LoadSubsetOptions
}

export type EnsureRemoteSubsetResponse =
  | {
      type: `rpc:ensureRemoteSubset:res`
      rpcId: string
      ok: true
    }
  | {
      type: `rpc:ensureRemoteSubset:res`
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

export type PersistedTx<
  T extends object,
  TKey extends string | number = string | number,
> = {
  txId: string
  term: number
  seq: number
  rowVersion: number
  mutations: Array<
    | { type: `insert`; key: TKey; value: T }
    | { type: `update`; key: TKey; value: T }
    | { type: `delete`; key: TKey; value: T }
  >
}

export interface PersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
> {
  loadSubset: (
    collectionId: string,
    options: LoadSubsetOptions,
    ctx?: { requiredIndexSignatures?: ReadonlyArray<string> },
  ) => Promise<Array<{ key: TKey; value: T }>>
  applyCommittedTx: (
    collectionId: string,
    tx: PersistedTx<T, TKey>,
  ) => Promise<void>
  ensureIndex: (
    collectionId: string,
    signature: string,
    spec: PersistedIndexSpec,
  ) => Promise<void>
  markIndexRemoved?: (collectionId: string, signature: string) => Promise<void>
}

export interface SQLiteDriver {
  exec: (sql: string) => Promise<void>
  query: <T>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ) => Promise<ReadonlyArray<T>>
  run: (sql: string, params?: ReadonlyArray<unknown>) => Promise<void>
  transaction: <T>(fn: () => Promise<T>) => Promise<T>
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
  requestEnsureRemoteSubset?: (
    collectionId: string,
    options: LoadSubsetOptions,
  ) => Promise<void>
  requestEnsurePersistedIndex: (
    collectionId: string,
    signature: string,
    spec: PersistedIndexSpec,
  ) => Promise<void>
  requestApplyLocalMutations?: (
    collectionId: string,
    mutations: Array<PersistedMutationEnvelope>,
  ) => Promise<ApplyLocalMutationsResponse>
  pullSince?: (
    collectionId: string,
    fromRowVersion: number,
  ) => Promise<PullSinceResponse>
}

export interface PersistedCollectionPersistence<
  T extends object,
  TKey extends string | number = string | number,
> {
  adapter: PersistenceAdapter<T, TKey>
  coordinator?: PersistedCollectionCoordinator
}

type PersistedResolvedPersistence<
  T extends object,
  TKey extends string | number,
> = PersistedCollectionPersistence<T, TKey> & {
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
  forceReloadSubset?: (options: LoadSubsetOptions) => Promise<void> | void
}

export type PersistedSyncWrappedOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
> = CollectionConfig<T, TKey, TSchema, TUtils> & {
  sync: SyncConfig<T, TKey>
  persistence: PersistedCollectionPersistence<T, TKey>
}

export type PersistedLocalOnlyOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
> = Omit<CollectionConfig<T, TKey, TSchema, TUtils>, `sync`> & {
  persistence: PersistedCollectionPersistence<T, TKey>
}

type PersistedSyncOptionsResult<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1,
  TUtils extends UtilsRecord,
> = CollectionConfig<T, TKey, TSchema, TUtils> & {
  persistence: PersistedResolvedPersistence<T, TKey>
}

type PersistedLocalOnlyOptionsResult<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1,
  TUtils extends UtilsRecord,
> = CollectionConfig<T, TKey, TSchema, TUtils & PersistedCollectionUtils> & {
  id: string
  persistence: PersistedResolvedPersistence<T, TKey>
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
    | `requestEnsurePersistedIndex`
  >
> = [
  `getNodeId`,
  `subscribe`,
  `publish`,
  `isLeader`,
  `ensureLeadership`,
  `requestEnsurePersistedIndex`,
]

const REQUIRED_ADAPTER_METHODS: ReadonlyArray<
  keyof Pick<
    PersistenceAdapter<object, string | number>,
    `loadSubset` | `applyCommittedTx` | `ensureIndex`
  >
> = [`loadSubset`, `applyCommittedTx`, `ensureIndex`]

const TARGETED_INVALIDATION_KEY_LIMIT = 128
const DEFAULT_DB_NAME = `tanstack-db`

type SyncControlFns<T extends object, TKey extends string | number> = {
  begin: ((options?: { immediate?: boolean }) => void) | null
  write:
    | ((
        message:
          | { type: `insert`; value: T }
          | { type: `update`; value: T }
          | { type: `delete`; key: TKey },
      ) => void)
    | null
  commit: (() => void) | null
  truncate: (() => void) | null
}

/**
 * Phase-0 coordinator implementation for single-process runtimes.
 * It satisfies the coordinator contract without cross-process transport.
 */
export class SingleProcessCoordinator implements PersistedCollectionCoordinator {
  private readonly nodeId: string

  constructor(nodeId: string = crypto.randomUUID()) {
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

  public async requestEnsureRemoteSubset(): Promise<void> {}

  public async requestEnsurePersistedIndex(): Promise<void> {}

  public requestApplyLocalMutations(
    _collectionId: string,
    mutations: Array<PersistedMutationEnvelope>,
  ): Promise<ApplyLocalMutationsResponse> {
    return Promise.resolve({
      type: `rpc:applyLocalMutations:res`,
      rpcId: crypto.randomUUID(),
      ok: true,
      term: 1,
      seq: mutations.length,
      latestRowVersion: mutations.length,
      acceptedMutationIds: mutations.map((mutation) => mutation.mutationId),
    })
  }

  public pullSince(): Promise<PullSinceResponse> {
    return Promise.resolve({
      type: `rpc:pullSince:res`,
      rpcId: crypto.randomUUID(),
      ok: true,
      latestTerm: 1,
      latestSeq: 0,
      latestRowVersion: 0,
      requiresFullReload: false,
      changedKeys: [],
      deletedKeys: [],
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

function validatePersistenceAdapter<
  T extends object,
  TKey extends string | number,
>(adapter: PersistenceAdapter<T, TKey>): void {
  for (const method of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter[method] !== `function`) {
      throw new InvalidPersistenceAdapterError(method)
    }
  }
}

function resolvePersistence<T extends object, TKey extends string | number>(
  persistence: PersistedCollectionPersistence<T, TKey>,
): PersistedResolvedPersistence<T, TKey> {
  validatePersistenceAdapter(persistence.adapter)

  const coordinator = persistence.coordinator ?? new SingleProcessCoordinator()
  validatePersistedCollectionCoordinator(coordinator)

  return {
    ...persistence,
    coordinator,
  }
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

type PersistedMode = `sync-present` | `sync-absent`

type NormalizedSyncOperation<T extends object, TKey extends string | number> =
  | {
      type: `update`
      key: TKey
      value: T
    }
  | {
      type: `delete`
      key: TKey
      value: T
    }

type BufferedSyncTransaction<T extends object, TKey extends string | number> = {
  operations: Array<NormalizedSyncOperation<T, TKey>>
  truncate: boolean
  internal: boolean
}

type OpenSyncTransaction<
  T extends object,
  TKey extends string | number,
> = BufferedSyncTransaction<T, TKey> & {
  queuedBecauseHydrating: boolean
}

type SyncWriteNormalization<T extends object, TKey extends string | number> = {
  forwardMessage:
    | {
        type: `update`
        value: T
      }
    | {
        type: `delete`
        key: TKey
      }
  operation: NormalizedSyncOperation<T, TKey>
}

class ApplyMutex {
  private queue: Promise<void> = Promise.resolve()

  async run<T>(task: () => Promise<T>): Promise<T> {
    const taskPromise = this.queue.then(() => task())
    this.queue = taskPromise.then(
      () => undefined,
      () => undefined,
    )
    return taskPromise
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
      return value.toString()
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

function normalizeSubsetOptionsForKey(
  options: LoadSubsetOptions,
): Record<string, unknown> {
  return {
    where: toStableSerializable(options.where),
    orderBy: toStableSerializable(options.orderBy),
    limit: options.limit,
    cursor: toStableSerializable(options.cursor),
    offset: options.offset,
  }
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
    Array.isArray(payload.changedKeys) && Array.isArray(payload.deletedKeys)
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
  private readonly pendingRemoteSubsetEnsures = new Map<
    string,
    LoadSubsetOptions
  >()
  private readonly queuedHydrationTransactions: Array<
    BufferedSyncTransaction<T, TKey>
  > = []
  private readonly queuedTxCommitted: Array<TxCommitted> = []
  private readonly subscriptionIds = new WeakMap<object, string>()

  private collection: Collection<T, TKey, PersistedCollectionUtils> | null =
    null
  private syncControls: SyncControlFns<T, TKey> = {
    begin: null,
    write: null,
    commit: null,
    truncate: null,
  }
  private started = false
  private startPromise: Promise<void> | null = null
  private internalApplyDepth = 0
  private isHydrating = false
  private coordinatorUnsubscribe: (() => void) | null = null
  private indexAddedUnsubscribe: (() => void) | null = null
  private indexRemovedUnsubscribe: (() => void) | null = null
  private nextSubscriptionId = 0

  private latestTerm = 0
  private latestSeq = 0
  private latestRowVersion = 0
  private localTerm = 1
  private localSeq = 0
  private localRowVersion = 0

  constructor(
    private readonly mode: PersistedMode,
    private readonly collectionId: string,
    private readonly persistence: PersistedResolvedPersistence<T, TKey>,
    private readonly syncMode: `eager` | `on-demand`,
    private readonly dbName: string,
  ) {}

  setSyncControls(syncControls: SyncControlFns<T, TKey>): void {
    this.syncControls = syncControls
  }

  clearSyncControls(): void {
    this.syncControls = {
      begin: null,
      write: null,
      commit: null,
      truncate: null,
    }
  }

  isHydratingNow(): boolean {
    return this.isHydrating
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
    this.attachIndexLifecycleListeners()
  }

  getLeadershipState(): PersistedCollectionLeadershipState {
    return {
      nodeId: this.persistence.coordinator.getNodeId(),
      isLeader: this.persistence.coordinator.isLeader(this.collectionId),
    }
  }

  async ensureStarted(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise
    }

    this.startPromise = this.startInternal()
    return this.startPromise
  }

  private async startInternal(): Promise<void> {
    if (this.started) {
      return
    }

    this.started = true
    await this.bootstrapPersistedIndexes()

    if (this.syncMode !== `on-demand`) {
      this.activeSubsets.set(this.getSubsetKey({}), {})
      await this.applyMutex.run(() =>
        this.hydrateSubsetUnsafe({}, { requestRemoteEnsure: false }),
      )
    }
  }

  async loadSubset(
    options: LoadSubsetOptions,
    upstreamLoadSubset?: (options: LoadSubsetOptions) => true | Promise<void>,
  ): Promise<void> {
    this.activeSubsets.set(this.getSubsetKey(options), options)

    await this.applyMutex.run(() =>
      this.hydrateSubsetUnsafe(options, {
        requestRemoteEnsure: this.mode === `sync-present`,
      }),
    )

    if (upstreamLoadSubset) {
      try {
        const maybePromise = upstreamLoadSubset(options)
        if (maybePromise instanceof Promise) {
          maybePromise.catch((error) => {
            console.warn(
              `Failed to load remote subset in persisted wrapper:`,
              error,
            )
            this.pendingRemoteSubsetEnsures.set(
              this.getSubsetKey(options),
              options,
            )
          })
        }
      } catch (error) {
        console.warn(`Failed to trigger remote subset load:`, error)
        this.pendingRemoteSubsetEnsures.set(this.getSubsetKey(options), options)
      }
    }
  }

  unloadSubset(
    options: LoadSubsetOptions,
    upstreamUnloadSubset?: (options: LoadSubsetOptions) => void,
  ): void {
    this.activeSubsets.delete(this.getSubsetKey(options))
    upstreamUnloadSubset?.(options)
  }

  async forceReloadSubset(options: LoadSubsetOptions): Promise<void> {
    this.activeSubsets.set(this.getSubsetKey(options), options)
    await this.applyMutex.run(() =>
      this.hydrateSubsetUnsafe(options, { requestRemoteEnsure: false }),
    )
  }

  queueHydrationBufferedTransaction(
    transaction: BufferedSyncTransaction<T, TKey>,
  ): void {
    this.queuedHydrationTransactions.push(transaction)
  }

  async persistAndBroadcastExternalSyncTransaction(
    transaction: BufferedSyncTransaction<T, TKey>,
  ): Promise<void> {
    await this.applyMutex.run(() =>
      this.persistAndBroadcastExternalSyncTransactionUnsafe(transaction),
    )
  }

  normalizeSyncWriteMessage(
    message: ChangeMessageOrDeleteKeyMessage<T, TKey>,
  ): SyncWriteNormalization<T, TKey> {
    if (!this.collection) {
      throw new InvalidPersistedCollectionConfigError(
        `collection must be attached before sync writes are processed`,
      )
    }

    if (message.type === `delete`) {
      const key = message.key
      const previousValue = this.collection.get(key) ?? ({} as T)

      return {
        forwardMessage: {
          type: `delete`,
          key,
        },
        operation: {
          type: `delete`,
          key,
          value: previousValue,
        },
      }
    }

    const key = this.collection.getKeyFromItem(message.value)
    return {
      forwardMessage: {
        type: `update`,
        value: message.value,
      },
      operation: {
        type: `update`,
        key,
        value: message.value,
      },
    }
  }

  async persistAndConfirmCollectionMutations(
    mutations: Array<PendingMutation<T>>,
  ): Promise<void> {
    if (mutations.length === 0) {
      return
    }

    await this.applyMutex.run(async () => {
      await this.persistCollectionMutationsUnsafe(mutations)
      this.confirmMutationsSyncUnsafe(mutations)
    })
  }

  async acceptTransactionMutations(transaction: {
    mutations: Array<PendingMutation<Record<string, unknown>>>
  }): Promise<void> {
    const collectionMutations = this.filterMutationsForCollection(
      transaction.mutations,
    )

    if (collectionMutations.length === 0) {
      return
    }

    await this.persistAndConfirmCollectionMutations(collectionMutations)
  }

  cleanup(): void {
    this.coordinatorUnsubscribe?.()
    this.coordinatorUnsubscribe = null

    this.indexAddedUnsubscribe?.()
    this.indexAddedUnsubscribe = null

    this.indexRemovedUnsubscribe?.()
    this.indexRemovedUnsubscribe = null

    this.pendingRemoteSubsetEnsures.clear()
    this.activeSubsets.clear()
    this.queuedHydrationTransactions.length = 0
    this.queuedTxCommitted.length = 0
    this.clearSyncControls()
  }

  private withInternalApply(task: () => void): void {
    this.internalApplyDepth++
    try {
      task()
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

  private async hydrateSubsetUnsafe(
    options: LoadSubsetOptions,
    config: {
      requestRemoteEnsure: boolean
    },
  ): Promise<void> {
    this.isHydrating = true
    try {
      const rows = await this.persistence.adapter.loadSubset(
        this.collectionId,
        options,
        {
          requiredIndexSignatures: this.getRequiredIndexSignatures(),
        },
      )

      this.applyRowsToCollection(rows)
    } finally {
      this.isHydrating = false
    }

    await this.flushQueuedHydrationTransactionsUnsafe()
    await this.flushQueuedTxCommittedUnsafe()

    if (config.requestRemoteEnsure) {
      this.pendingRemoteSubsetEnsures.set(this.getSubsetKey(options), options)
      void this.flushPendingRemoteSubsetEnsures()
    }
  }

  private applyRowsToCollection(rows: Array<{ key: TKey; value: T }>): void {
    if (
      !this.syncControls.begin ||
      !this.syncControls.write ||
      !this.syncControls.commit
    ) {
      return
    }

    this.withInternalApply(() => {
      this.syncControls.begin?.({ immediate: true })

      for (const row of rows) {
        this.syncControls.write?.({
          type: `update`,
          value: row.value,
        })
      }

      this.syncControls.commit?.()
    })
  }

  private async flushQueuedHydrationTransactionsUnsafe(): Promise<void> {
    while (this.queuedHydrationTransactions.length > 0) {
      const transaction = this.queuedHydrationTransactions.shift()
      if (!transaction) {
        continue
      }
      await this.applyBufferedSyncTransactionUnsafe(transaction)
    }
  }

  private async applyBufferedSyncTransactionUnsafe(
    transaction: BufferedSyncTransaction<T, TKey>,
  ): Promise<void> {
    if (
      !this.syncControls.begin ||
      !this.syncControls.write ||
      !this.syncControls.commit
    ) {
      return
    }

    const applyToCollection = () => {
      this.syncControls.begin?.()

      if (transaction.truncate) {
        this.syncControls.truncate?.()
      }

      for (const operation of transaction.operations) {
        if (operation.type === `delete`) {
          this.syncControls.write?.({
            type: `delete`,
            key: operation.key,
          })
        } else {
          this.syncControls.write?.({
            type: `update`,
            value: operation.value,
          })
        }
      }

      this.syncControls.commit?.()
    }

    if (transaction.internal) {
      this.withInternalApply(applyToCollection)
      return
    }

    applyToCollection()
    await this.persistAndBroadcastExternalSyncTransactionUnsafe(transaction)
  }

  private async persistAndBroadcastExternalSyncTransactionUnsafe(
    transaction: BufferedSyncTransaction<T, TKey>,
  ): Promise<void> {
    if (transaction.internal) {
      return
    }

    const streamPosition = this.nextLocalStreamPosition()

    if (transaction.truncate || transaction.operations.length === 0) {
      this.publishTxCommittedEvent({
        term: streamPosition.term,
        seq: streamPosition.seq,
        txId: crypto.randomUUID(),
        latestRowVersion: streamPosition.rowVersion,
        requiresFullReload: true,
      })
      return
    }

    const tx = this.createPersistedTxFromOperations(
      transaction.operations,
      streamPosition,
    )

    await this.persistence.adapter.applyCommittedTx(this.collectionId, tx)
    this.publishTxCommittedEvent({
      term: tx.term,
      seq: tx.seq,
      txId: tx.txId,
      latestRowVersion: tx.rowVersion,
      requiresFullReload:
        transaction.operations.length > TARGETED_INVALIDATION_KEY_LIMIT,
      ...(transaction.operations.length > TARGETED_INVALIDATION_KEY_LIMIT
        ? {}
        : {
            changedKeys: transaction.operations
              .filter((operation) => operation.type === `update`)
              .map((operation) => operation.key),
            deletedKeys: transaction.operations
              .filter((operation) => operation.type === `delete`)
              .map((operation) => operation.key),
          }),
    })
  }

  private createPersistedTxFromOperations(
    operations: Array<NormalizedSyncOperation<T, TKey>>,
    streamPosition: { term: number; seq: number; rowVersion: number },
  ): PersistedTx<T, TKey> {
    return {
      txId: crypto.randomUUID(),
      term: streamPosition.term,
      seq: streamPosition.seq,
      rowVersion: streamPosition.rowVersion,
      mutations: operations.map((operation) =>
        operation.type === `update`
          ? {
              type: `update`,
              key: operation.key,
              value: operation.value,
            }
          : {
              type: `delete`,
              key: operation.key,
              value: operation.value,
            },
      ),
    }
  }

  private createPersistedTxFromMutations(
    mutations: Array<PendingMutation<T>>,
    streamPosition: { term: number; seq: number; rowVersion: number },
  ): PersistedTx<T, TKey> {
    return {
      txId: crypto.randomUUID(),
      term: streamPosition.term,
      seq: streamPosition.seq,
      rowVersion: streamPosition.rowVersion,
      mutations: mutations.map((mutation) => {
        if (mutation.type === `delete`) {
          return {
            type: `delete`,
            key: mutation.key as TKey,
            value: mutation.original as T,
          }
        }

        if (mutation.type === `insert`) {
          return {
            type: `insert`,
            key: mutation.key as TKey,
            value: mutation.modified,
          }
        }

        return {
          type: `update`,
          key: mutation.key as TKey,
          value: mutation.modified,
        }
      }),
    }
  }

  private confirmMutationsSyncUnsafe(
    mutations: Array<PendingMutation<T>>,
  ): void {
    if (
      !this.syncControls.begin ||
      !this.syncControls.write ||
      !this.syncControls.commit
    ) {
      return
    }

    this.withInternalApply(() => {
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

      this.syncControls.commit?.()
    })
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
  ): Promise<void> {
    if (
      this.persistence.coordinator.requestApplyLocalMutations &&
      !this.persistence.coordinator.isLeader(this.collectionId)
    ) {
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

      if (!response.ok) {
        throw new Error(
          `failed to apply local mutations through coordinator: ${response.error}`,
        )
      }

      this.observeStreamPosition(
        response.term,
        response.seq,
        response.latestRowVersion,
      )
      return
    }

    const streamPosition = this.nextLocalStreamPosition()
    const tx = this.createPersistedTxFromMutations(mutations, streamPosition)
    await this.persistence.adapter.applyCommittedTx(this.collectionId, tx)

    this.publishTxCommittedEvent({
      type: `tx:committed`,
      term: tx.term,
      seq: tx.seq,
      txId: tx.txId,
      latestRowVersion: tx.rowVersion,
      requiresFullReload: mutations.length > TARGETED_INVALIDATION_KEY_LIMIT,
      ...(mutations.length > TARGETED_INVALIDATION_KEY_LIMIT
        ? {}
        : {
            changedKeys: mutations
              .filter((mutation) => mutation.type !== `delete`)
              .map((mutation) => mutation.key as TKey),
            deletedKeys: mutations
              .filter((mutation) => mutation.type === `delete`)
              .map((mutation) => mutation.key as TKey),
          }),
    })
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
    const subscription = options.subscription as object | undefined
    if (subscription && typeof subscription === `object`) {
      const existingId = this.subscriptionIds.get(subscription)
      if (existingId) {
        return existingId
      }

      this.nextSubscriptionId++
      const id = `sub:${this.nextSubscriptionId}`
      this.subscriptionIds.set(subscription, id)
      return id
    }

    return `opts:${stableSerialize(normalizeSubsetOptionsForKey(options))}`
  }

  private async flushPendingRemoteSubsetEnsures(): Promise<void> {
    if (
      this.mode !== `sync-present` ||
      !this.persistence.coordinator.requestEnsureRemoteSubset
    ) {
      return
    }

    for (const [subsetKey, options] of this.pendingRemoteSubsetEnsures) {
      try {
        await this.persistence.coordinator.requestEnsureRemoteSubset(
          this.collectionId,
          options,
        )
        this.pendingRemoteSubsetEnsures.delete(subsetKey)
      } catch (error) {
        console.warn(`Failed to ensure remote subset:`, error)
      }
    }
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

    if (message.senderId === this.persistence.coordinator.getNodeId()) {
      return
    }

    if (isTxCommittedPayload(message.payload)) {
      if (this.isHydrating) {
        this.queuedTxCommitted.push(message.payload)
        return
      }

      void this.applyMutex
        .run(() => this.processCommittedTxUnsafe(message.payload))
        .catch((error) => {
          console.warn(`Failed to process tx:committed message:`, error)
        })
      return
    }

    if (isCollectionResetPayload(message.payload)) {
      void this.applyMutex
        .run(() => this.truncateAndReloadUnsafe())
        .catch((error) => {
          console.warn(`Failed to process collection reset message:`, error)
        })
    }
  }

  private async flushQueuedTxCommittedUnsafe(): Promise<void> {
    while (this.queuedTxCommitted.length > 0) {
      const queued = this.queuedTxCommitted.shift()
      if (!queued) {
        continue
      }
      await this.processCommittedTxUnsafe(queued)
    }
  }

  private async processCommittedTxUnsafe(
    txCommitted: TxCommitted,
  ): Promise<void> {
    if (txCommitted.term < this.latestTerm) {
      return
    }

    if (
      txCommitted.term === this.latestTerm &&
      txCommitted.seq <= this.latestSeq
    ) {
      return
    }

    const hasGap =
      txCommitted.term === this.latestTerm &&
      this.latestSeq > 0 &&
      txCommitted.seq > this.latestSeq + 1

    if (hasGap) {
      await this.recoverFromSeqGapUnsafe()
    }

    this.observeStreamPosition(
      txCommitted.term,
      txCommitted.seq,
      txCommitted.latestRowVersion,
    )

    await this.invalidateFromCommittedTxUnsafe(txCommitted)
  }

  private async recoverFromSeqGapUnsafe(): Promise<void> {
    if (this.persistence.coordinator.pullSince && this.latestRowVersion >= 0) {
      try {
        const pullResponse = await this.persistence.coordinator.pullSince(
          this.collectionId,
          this.latestRowVersion,
        )

        if (pullResponse.ok) {
          this.observeStreamPosition(
            pullResponse.latestTerm,
            pullResponse.latestSeq,
            pullResponse.latestRowVersion,
          )
          await this.reloadActiveSubsetsUnsafe()
          return
        }
      } catch (error) {
        console.warn(`Failed pullSince recovery attempt:`, error)
      }
    }

    await this.truncateAndReloadUnsafe()

    if (this.mode === `sync-present`) {
      for (const [subsetKey, options] of this.activeSubsets) {
        this.pendingRemoteSubsetEnsures.set(subsetKey, options)
      }
      void this.flushPendingRemoteSubsetEnsures()
    }
  }

  private async truncateAndReloadUnsafe(): Promise<void> {
    if (this.syncControls.begin && this.syncControls.commit) {
      this.withInternalApply(() => {
        this.syncControls.begin?.({ immediate: true })
        this.syncControls.truncate?.()
        this.syncControls.commit?.()
      })
    }

    await this.reloadActiveSubsetsUnsafe()
  }

  private async invalidateFromCommittedTxUnsafe(
    txCommitted: TxCommitted,
  ): Promise<void> {
    if (txCommitted.requiresFullReload) {
      await this.reloadActiveSubsetsUnsafe()
      return
    }

    const changedKeyCount =
      txCommitted.changedKeys.length + txCommitted.deletedKeys.length
    if (changedKeyCount > TARGETED_INVALIDATION_KEY_LIMIT) {
      await this.reloadActiveSubsetsUnsafe()
      return
    }

    // Best-effort invalidation: correctness over precision.
    // We conservatively reload all active subsets to avoid stale reads.
    await this.reloadActiveSubsetsUnsafe()
  }

  private async reloadActiveSubsetsUnsafe(): Promise<void> {
    const activeSubsetOptions =
      this.activeSubsets.size > 0
        ? Array.from(this.activeSubsets.values())
        : [{}]

    for (const options of activeSubsetOptions) {
      await this.hydrateSubsetUnsafe(options, { requestRemoteEnsure: false })
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

  private async bootstrapPersistedIndexes(): Promise<void> {
    if (!this.collection) {
      return
    }

    const indexMetadata = this.collection.getIndexMetadata()
    for (const metadata of indexMetadata) {
      await this.ensurePersistedIndex(metadata)
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
  ): Promise<void> {
    const spec = this.buildPersistedIndexSpec(indexMetadata)

    try {
      await this.persistence.adapter.ensureIndex(
        this.collectionId,
        indexMetadata.signature,
        spec,
      )
    } catch (error) {
      console.warn(`Failed to ensure persisted index in adapter:`, error)
    }

    try {
      await this.persistence.coordinator.requestEnsurePersistedIndex(
        this.collectionId,
        indexMetadata.signature,
        spec,
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
      runtime.setSyncControls({
        begin: params.begin,
        write: params.write as SyncControlFns<T, TKey>[`write`],
        commit: params.commit,
        truncate: params.truncate,
      })
      runtime.setCollection(
        params.collection as Collection<T, TKey, PersistedCollectionUtils>,
      )

      const wrappedParams = {
        ...params,
        markReady: () => {
          void runtime
            .ensureStarted()
            .then(() => {
              params.markReady()
            })
            .catch((error) => {
              console.warn(
                `Failed persisted sync startup before markReady:`,
                error,
              )
              params.markReady()
            })
        },
        begin: (options?: { immediate?: boolean }) => {
          const transaction: OpenSyncTransaction<T, TKey> = {
            operations: [],
            truncate: false,
            internal: runtime.isApplyingInternally(),
            queuedBecauseHydrating:
              !runtime.isApplyingInternally() && runtime.isHydratingNow(),
          }
          transactionStack.push(transaction)

          if (!transaction.queuedBecauseHydrating) {
            params.begin(options)
          }
        },
        write: (message: ChangeMessageOrDeleteKeyMessage<T, TKey>) => {
          const normalization = runtime.normalizeSyncWriteMessage(message)
          const openTransaction = transactionStack[transactionStack.length - 1]

          if (!openTransaction) {
            params.write(normalization.forwardMessage)
            return
          }

          openTransaction.operations.push(normalization.operation)
          if (!openTransaction.queuedBecauseHydrating) {
            params.write(normalization.forwardMessage)
          }
        },
        truncate: () => {
          const openTransaction = transactionStack[transactionStack.length - 1]
          if (!openTransaction) {
            params.truncate()
            return
          }

          openTransaction.truncate = true
          if (!openTransaction.queuedBecauseHydrating) {
            params.truncate()
          }
        },
        commit: () => {
          const openTransaction = transactionStack.pop()
          if (!openTransaction) {
            params.commit()
            return
          }

          if (openTransaction.queuedBecauseHydrating) {
            runtime.queueHydrationBufferedTransaction({
              operations: openTransaction.operations,
              truncate: openTransaction.truncate,
              internal: openTransaction.internal,
            })
            return
          }

          params.commit()
          if (!openTransaction.internal) {
            void runtime
              .persistAndBroadcastExternalSyncTransaction({
                operations: openTransaction.operations,
                truncate: openTransaction.truncate,
                internal: false,
              })
              .catch((error) => {
                console.warn(
                  `Failed to persist wrapped sync transaction:`,
                  error,
                )
              })
          }
        },
      }

      const sourceResult = normalizeSyncFnResult(
        sourceSyncConfig.sync(wrappedParams),
      )
      void runtime.ensureStarted()

      return {
        cleanup: () => {
          sourceResult.cleanup?.()
          runtime.cleanup()
          runtime.clearSyncControls()
        },
        loadSubset: (options: LoadSubsetOptions) =>
          runtime.loadSubset(options, sourceResult.loadSubset),
        unloadSubset: (options: LoadSubsetOptions) =>
          runtime.unloadSubset(options, sourceResult.unloadSubset),
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
      })
      runtime.setCollection(
        params.collection as Collection<T, TKey, PersistedCollectionUtils>,
      )

      void runtime
        .ensureStarted()
        .then(() => {
          params.markReady()
        })
        .catch((error) => {
          console.warn(`Failed persisted loopback startup:`, error)
          params.markReady()
        })

      return {
        cleanup: () => {
          runtime.cleanup()
          runtime.clearSyncControls()
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
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
>(
  options: PersistedSyncWrappedOptions<T, TKey, TSchema, TUtils>,
): PersistedSyncOptionsResult<T, TKey, TSchema, TUtils>

export function persistedCollectionOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
>(
  options: PersistedLocalOnlyOptions<T, TKey, TSchema, TUtils>,
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

  const persistence = resolvePersistence(options.persistence)

  if (hasOwnSyncKey(options)) {
    if (!isValidSyncConfig(options.sync)) {
      throw new InvalidSyncConfigError(
        `when the "sync" key is present it must provide a callable sync function`,
      )
    }

    const runtime = new PersistedCollectionRuntime<T, TKey>(
      `sync-present`,
      options.id ?? `persisted-collection:${crypto.randomUUID()}`,
      persistence,
      options.syncMode ?? `eager`,
      options.id ?? DEFAULT_DB_NAME,
    )

    return {
      ...options,
      sync: createWrappedSyncConfig(options.sync, runtime),
      persistence,
    }
  }

  const localOnlyOptions = options
  const collectionId =
    localOnlyOptions.id ?? `persisted-collection:${crypto.randomUUID()}`
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
    const handlerResult = localOnlyOptions.onInsert
      ? await localOnlyOptions.onInsert(
          params as unknown as InsertMutationFnParams<T, TKey, TUtils>,
        )
      : undefined

    await runtime.persistAndConfirmCollectionMutations(
      params.transaction.mutations as Array<PendingMutation<T>>,
    )

    return handlerResult ?? {}
  }

  const wrappedOnUpdate = async (
    params: UpdateMutationFnParams<T, TKey, TUtils & PersistedCollectionUtils>,
  ) => {
    const handlerResult = localOnlyOptions.onUpdate
      ? await localOnlyOptions.onUpdate(
          params as unknown as UpdateMutationFnParams<T, TKey, TUtils>,
        )
      : undefined

    await runtime.persistAndConfirmCollectionMutations(
      params.transaction.mutations as Array<PendingMutation<T>>,
    )

    return handlerResult ?? {}
  }

  const wrappedOnDelete = async (
    params: DeleteMutationFnParams<T, TKey, TUtils & PersistedCollectionUtils>,
  ) => {
    const handlerResult = localOnlyOptions.onDelete
      ? await localOnlyOptions.onDelete(
          params as unknown as DeleteMutationFnParams<T, TKey, TUtils>,
        )
      : undefined

    await runtime.persistAndConfirmCollectionMutations(
      params.transaction.mutations as Array<PendingMutation<T>>,
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

  return {
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
