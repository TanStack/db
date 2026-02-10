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
  Collection,
  CollectionConfig,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  LoadSubsetOptions,
  PendingMutation,
  SyncConfig,
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
  }) => void
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

  public async requestEnsurePersistedIndex(): Promise<void> {}
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

function createLoopbackSync<T extends object, TKey extends string | number>() {
  let collection: Collection<T, TKey, PersistedCollectionUtils> | null = null
  const syncControls: SyncControlFns<T, TKey> = {
    begin: null,
    write: null,
    commit: null,
  }

  const sync: SyncConfig<T, TKey> = {
    sync: (params) => {
      syncControls.begin = params.begin
      syncControls.write = params.write as SyncControlFns<T, TKey>[`write`]
      syncControls.commit = params.commit
      collection = params.collection as Collection<
        T,
        TKey,
        PersistedCollectionUtils
      >
      params.markReady()
      return () => {}
    },
    getSyncMetadata: () => ({
      source: `persisted-phase-0-loopback`,
    }),
  }

  const confirmOperationsSync = (mutations: Array<PendingMutation<T>>) => {
    if (!syncControls.begin || !syncControls.write || !syncControls.commit) {
      return
    }

    syncControls.begin({ immediate: true })

    for (const mutation of mutations) {
      if (mutation.type === `delete`) {
        syncControls.write({
          type: `delete`,
          key: mutation.key as TKey,
        })
      } else {
        syncControls.write({
          type: mutation.type,
          value: mutation.modified,
        })
      }
    }

    syncControls.commit()
  }

  return {
    sync,
    confirmOperationsSync,
    getCollection: () => collection,
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

    return {
      ...options,
      sync: options.sync as SyncConfig<T, TKey>,
      persistence,
    }
  }

  const localOnlyOptions = options
  const loopbackSync = createLoopbackSync<T, TKey>()
  const collectionId =
    localOnlyOptions.id ?? `persisted-collection:${crypto.randomUUID()}`

  const wrappedOnInsert = async (
    params: InsertMutationFnParams<T, TKey, TUtils & PersistedCollectionUtils>,
  ) => {
    const handlerResult = localOnlyOptions.onInsert
      ? await localOnlyOptions.onInsert(
          params as unknown as InsertMutationFnParams<T, TKey, TUtils>,
        )
      : undefined

    loopbackSync.confirmOperationsSync(
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

    loopbackSync.confirmOperationsSync(
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

    loopbackSync.confirmOperationsSync(
      params.transaction.mutations as Array<PendingMutation<T>>,
    )

    return handlerResult ?? {}
  }

  const acceptMutations = (transaction: {
    mutations: Array<PendingMutation<Record<string, unknown>>>
  }) => {
    const collection = loopbackSync.getCollection()
    const collectionMutations = transaction.mutations.filter((mutation) => {
      if (collection) {
        return mutation.collection === collection
      }
      return mutation.collection.id === collectionId
    })

    if (collectionMutations.length === 0) {
      return
    }

    loopbackSync.confirmOperationsSync(
      collectionMutations as Array<PendingMutation<T>>,
    )
  }

  const persistedUtils: PersistedCollectionUtils = {
    acceptMutations,
    getLeadershipState: () => ({
      nodeId: persistence.coordinator.getNodeId(),
      isLeader: persistence.coordinator.isLeader(collectionId),
    }),
  }

  const mergedUtils = {
    ...(localOnlyOptions.utils ?? ({} as TUtils)),
    ...persistedUtils,
  }

  return {
    ...localOnlyOptions,
    id: collectionId,
    persistence,
    sync: loopbackSync.sync,
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
