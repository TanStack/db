import {
  ShapeStream,
  isChangeMessage,
  isControlMessage,
  isVisibleInSnapshot,
} from '@electric-sql/client'
import DebugModule from 'debug'
import {
  DeduplicatedLoadSubset,
  and,
  withCollectionConfigFactory,
  withCollectionSyncConfigCleanup,
  withCollectionSyncConfigFactory,
} from '@tanstack/db'
import {
  ExpectedNumberInAwaitTxIdError,
  StreamAbortedError,
  TimeoutWaitingForMatchError,
  TimeoutWaitingForTxIdError,
} from './errors'
import { compileSQL } from './sql-compiler'
import {
  addTagToIndex,
  deriveDisjunctPositions,
  findRowsMatchingPattern,
  getTagLength,
  isMoveInMessage,
  isMoveOutMessage,
  parseTag as parseTagString,
  removeTagFromIndex,
  rowVisible,
  tagMatchesPattern,
} from './tag-index'
import type { ColumnEncoder } from './sql-compiler'
import type {
  ActiveConditions,
  DisjunctPositions,
  MovePattern,
  MoveTag,
  ParsedMoveTag,
  RowId,
  TagIndex,
} from './tag-index'
import type {
  BaseCollectionConfig,
  ChangeMessageOrDeleteKeyMessage,
  CollectionConfig,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  LoadSubsetOptions,
  SyncAppliedReceipt,
  SyncConfig,
  SyncMetadataApi,
  SyncMode,
  UpdateMutationFnParams,
  UtilsRecord,
} from '@tanstack/db'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  ControlMessage,
  GetExtensions,
  Message,
  Offset,
  PostgresSnapshot,
  Row,
  ShapeStreamOptions,
} from '@electric-sql/client'

type ElectricSyncMetadataWithPersistedScan = SyncMetadataApi<
  string | number
> & {
  row: SyncMetadataApi<string | number>[`row`] & {
    whenHydrated?: () => Promise<void>
    scanPersisted?: (options?: {
      metadataOnly?: boolean
    }) => Promise<Array<{ key: string | number }>>
  }
}

// Re-export for user convenience in custom match functions
export { isChangeMessage, isControlMessage } from '@electric-sql/client'

const debug = DebugModule.debug(`ts/db:electric`)

const FORCE_DISCONNECT_AND_REFRESH_TIMEOUT_MS = 250

/**
 * Symbol for internal test hooks (hidden from public API)
 */
export const ELECTRIC_TEST_HOOKS = Symbol(`electricTestHooks`)

/**
 * Internal test hooks interface (for testing only)
 */
export interface ElectricTestHooks {
  /**
   * Called before marking collection ready after first up-to-date in progressive mode
   * Allows tests to pause and validate snapshot phase before atomic swap completes
   */
  beforeMarkingReady?: () => Promise<void>
}

/**
 * Type representing a transaction ID in ElectricSQL
 */
export type Txid = number

type ElectricResumeState =
  | {
      kind: `resume`
      offset: string
      handle: string
      shapeId: string
      updatedAt: number
    }
  | {
      kind: `reset`
      updatedAt: number
    }

type ElectricSyncMeta = {
  version: 1
  resume?: ElectricResumeState
  seenTxids: Array<Txid>
}

type ElectricLifecycleEvidence = {
  seenTxids: Set<Txid>
  seenSnapshots: Array<PostgresSnapshot>
  hydratedResumeState?: ElectricResumeState
}

type ElectricPendingMatch<T extends Row<unknown>> = {
  matchFn: (message: Message<T>) => boolean
  resolve: (value: boolean) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
  matched: boolean
}

type ElectricMatchBuffer<T extends Row<unknown>> = {
  committedMessages: Array<Message<T>>
  pendingMessages: Array<Message<T>>
}

function exportElectricSyncMeta(
  evidence: ElectricLifecycleEvidence,
): ElectricSyncMeta {
  const resume = evidence.hydratedResumeState
  return {
    version: 1,
    ...(resume ? { resume } : {}),
    seenTxids: Array.from(evidence.seenTxids).sort((a, b) => a - b),
  }
}

function importElectricSyncMeta(
  evidence: ElectricLifecycleEvidence,
  meta: unknown,
): void {
  const parsed = parseElectricSyncMeta(meta)
  if (!parsed) return

  evidence.hydratedResumeState = parsed.resume
  evidence.seenTxids = new Set(parsed.seenTxids)
}

function parseElectricResumeState(
  value: unknown,
): ElectricResumeState | undefined {
  if (!value || typeof value !== `object`) {
    return undefined
  }

  const record = value as Record<string, unknown>
  if (
    record.kind === `resume` &&
    typeof record.offset === `string` &&
    typeof record.handle === `string` &&
    typeof record.shapeId === `string` &&
    typeof record.updatedAt === `number` &&
    Number.isFinite(record.updatedAt)
  ) {
    return {
      kind: `resume`,
      offset: record.offset,
      handle: record.handle,
      shapeId: record.shapeId,
      updatedAt: record.updatedAt,
    }
  }

  if (
    record.kind === `reset` &&
    typeof record.updatedAt === `number` &&
    Number.isFinite(record.updatedAt)
  ) {
    return {
      kind: `reset`,
      updatedAt: record.updatedAt,
    }
  }

  return undefined
}

function parseElectricSyncMeta(value: unknown): ElectricSyncMeta | undefined {
  if (!value || typeof value !== `object`) {
    return undefined
  }

  const record = value as Record<string, unknown>
  if (
    record.version !== 1 ||
    !Array.isArray(record.seenTxids) ||
    !record.seenTxids.every(
      (txid) => typeof txid === `number` && Number.isFinite(txid),
    )
  ) {
    return undefined
  }

  const resume =
    record.resume === undefined
      ? undefined
      : parseElectricResumeState(record.resume)
  if (record.resume !== undefined && resume === undefined) {
    return undefined
  }

  return {
    version: 1,
    ...(resume ? { resume } : {}),
    seenTxids: Array.from(new Set(record.seenTxids)).sort((a, b) => a - b),
  }
}

function mergeElectricSyncMeta(
  current: unknown,
  incoming: unknown,
): ElectricSyncMeta | unknown {
  const currentMeta = parseElectricSyncMeta(current)
  const incomingMeta = parseElectricSyncMeta(incoming)

  if (!incomingMeta) {
    return current
  }
  if (!currentMeta) {
    return incomingMeta
  }

  const resume = getNewestElectricResumeState(
    currentMeta.resume,
    incomingMeta.resume,
  )

  return {
    version: 1,
    ...(resume ? { resume } : {}),
    seenTxids: Array.from(
      new Set([...currentMeta.seenTxids, ...incomingMeta.seenTxids]),
    ).sort((a, b) => a - b),
  }
}

function getNewestElectricResumeState(
  current: ElectricResumeState | undefined,
  incoming: ElectricResumeState | undefined,
): ElectricResumeState | undefined {
  if (!current) return incoming
  if (!incoming) return current
  if (incoming.updatedAt > current.updatedAt) return incoming
  if (incoming.updatedAt < current.updatedAt) return current

  const isSameState =
    current.kind === incoming.kind &&
    (current.kind === `reset` ||
      (incoming.kind === `resume` &&
        current.offset === incoming.offset &&
        current.handle === incoming.handle &&
        current.shapeId === incoming.shapeId))

  // Equal timestamps have no causal ordering. Preserve an identical state,
  // but collapse every conflict to reset so merge order cannot resurrect an
  // offset that another source has already declared unsafe.
  return isSameState ? current : { kind: `reset`, updatedAt: current.updatedAt }
}

/**
 * Custom match function type - receives stream messages and returns boolean
 * indicating if the mutation has been synchronized
 */
export type MatchFunction<T extends Row<unknown>> = (
  message: Message<T>,
) => boolean

/**
 * Matching strategies for Electric synchronization
 * Handlers can return:
 * - Txid strategy: { txid: number | number[], timeout?: number } (recommended)
 * - Void (no return value) - mutation completes without waiting
 *
 * The optional timeout property specifies how long to wait for the txid(s) in milliseconds.
 * If not specified, defaults to 5000ms.
 */
export type MatchingStrategy = {
  txid: Txid | Array<Txid>
  timeout?: number
} | void

/**
 * Type representing a snapshot end message
 */
type SnapshotEndMessage = ControlMessage & {
  headers: { control: `snapshot-end` }
}
// The `InferSchemaOutput` and `ResolveType` are copied from the `@tanstack/db` package
// but we modified `InferSchemaOutput` slightly to restrict the schema output to `Row<unknown>`
// This is needed in order for `GetExtensions` to be able to infer the parser extensions type from the schema
type InferSchemaOutput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T> extends Row<unknown>
    ? StandardSchemaV1.InferOutput<T>
    : Record<string, unknown>
  : Record<string, unknown>

/**
 * The mode of sync to use for the collection.
 * @default `eager`
 * @description
 * - `eager`:
 *   - syncs all data immediately on preload
 *   - collection will be marked as ready once the sync is complete
 *   - there is no incremental sync
 * - `on-demand`:
 *   - syncs data in incremental snapshots when the collection is queried
 *   - collection will be marked as ready immediately after the first snapshot is synced
 * - `progressive`:
 *   - syncs all data for the collection in the background
 *   - uses incremental snapshots during the initial sync to provide a fast path to the data required for queries
 *   - collection will be marked as ready once the full sync is complete
 */
export type ElectricSyncMode = SyncMode | `progressive`

/**
 * Configuration interface for Electric collection options
 * @template T - The type of items in the collection
 * @template TSchema - The schema type for validation
 */
export interface ElectricCollectionConfig<
  T extends Row<unknown> = Row<unknown>,
  TSchema extends StandardSchemaV1 = never,
> extends Omit<
  BaseCollectionConfig<
    T,
    string | number,
    TSchema,
    ElectricCollectionUtils<T>,
    any
  >,
  `onInsert` | `onUpdate` | `onDelete` | `syncMode`
> {
  /**
   * Configuration options for the ElectricSQL ShapeStream
   */
  shapeOptions: ShapeStreamOptions<GetExtensions<T>>
  syncMode?: ElectricSyncMode

  /**
   * Internal test hooks (for testing only)
   * Hidden via Symbol to prevent accidental usage in production
   */
  [ELECTRIC_TEST_HOOKS]?: ElectricTestHooks

  /**
   * Optional asynchronous handler function called before an insert operation
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to { txid, timeout? } or void
   * @example
   * // Basic Electric insert handler with txid (recommended)
   * onInsert: async ({ transaction }) => {
   *   const newItem = transaction.mutations[0].modified
   *   const result = await api.todos.create({
   *     data: newItem
   *   })
   *   return { txid: result.txid }
   * }
   *
   * @example
   * // Insert handler with custom timeout
   * onInsert: async ({ transaction }) => {
   *   const newItem = transaction.mutations[0].modified
   *   const result = await api.todos.create({
   *     data: newItem
   *   })
   *   return { txid: result.txid, timeout: 10000 } // Wait up to 10 seconds
   * }
   *
   * @example
   * // Insert handler with multiple items - return array of txids
   * onInsert: async ({ transaction }) => {
   *   const items = transaction.mutations.map(m => m.modified)
   *   const results = await Promise.all(
   *     items.map(item => api.todos.create({ data: item }))
   *   )
   *   return { txid: results.map(r => r.txid) }
   * }
   *
   * @example
   * // Use awaitMatch utility for custom matching
   * onInsert: async ({ transaction, collection }) => {
   *   const newItem = transaction.mutations[0].modified
   *   await api.todos.create({ data: newItem })
   *   await collection.utils.awaitMatch(
   *     (message) => isChangeMessage(message) &&
   *                  message.headers.operation === 'insert' &&
   *                  message.value.name === newItem.name
   *   )
   * }
   */
  onInsert?: (
    params: InsertMutationFnParams<
      T,
      string | number,
      ElectricCollectionUtils<T>
    >,
  ) => Promise<MatchingStrategy>

  /**
   * Optional asynchronous handler function called before an update operation
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to { txid, timeout? } or void
   * @example
   * // Basic Electric update handler with txid (recommended)
   * onUpdate: async ({ transaction }) => {
   *   const { original, changes } = transaction.mutations[0]
   *   const result = await api.todos.update({
   *     where: { id: original.id },
   *     data: changes
   *   })
   *   return { txid: result.txid }
   * }
   *
   * @example
   * // Use awaitMatch utility for custom matching
   * onUpdate: async ({ transaction, collection }) => {
   *   const { original, changes } = transaction.mutations[0]
   *   await api.todos.update({ where: { id: original.id }, data: changes })
   *   await collection.utils.awaitMatch(
   *     (message) => isChangeMessage(message) &&
   *                  message.headers.operation === 'update' &&
   *                  message.value.id === original.id
   *   )
   * }
   */
  onUpdate?: (
    params: UpdateMutationFnParams<
      T,
      string | number,
      ElectricCollectionUtils<T>
    >,
  ) => Promise<MatchingStrategy>

  /**
   * Optional asynchronous handler function called before a delete operation
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to { txid, timeout? } or void
   * @example
   * // Basic Electric delete handler with txid (recommended)
   * onDelete: async ({ transaction }) => {
   *   const mutation = transaction.mutations[0]
   *   const result = await api.todos.delete({
   *     id: mutation.original.id
   *   })
   *   return { txid: result.txid }
   * }
   *
   * @example
   * // Use awaitMatch utility for custom matching
   * onDelete: async ({ transaction, collection }) => {
   *   const mutation = transaction.mutations[0]
   *   await api.todos.delete({ id: mutation.original.id })
   *   await collection.utils.awaitMatch(
   *     (message) => isChangeMessage(message) &&
   *                  message.headers.operation === 'delete' &&
   *                  message.value.id === mutation.original.id
   *   )
   * }
   */
  onDelete?: (
    params: DeleteMutationFnParams<
      T,
      string | number,
      ElectricCollectionUtils<T>
    >,
  ) => Promise<MatchingStrategy>
}

function isUpToDateMessage<T extends Row<unknown>>(
  message: Message<T>,
): message is ControlMessage & { up_to_date: true } {
  return isControlMessage(message) && message.headers.control === `up-to-date`
}

function isMustRefetchMessage<T extends Row<unknown>>(
  message: Message<T>,
): message is ControlMessage & { headers: { control: `must-refetch` } } {
  return isControlMessage(message) && message.headers.control === `must-refetch`
}

function planBatchPresence<T extends Row<unknown>>(
  messages: ReadonlyArray<Message<T>>,
  getKey: (row: T) => string | number,
  hasKnownKey: (key: string | number) => boolean,
  validatesResume: boolean,
): {
  messageKeys: Map<Message<T>, string | number>
  hasUnseenUpdate: boolean
} {
  const presence = new Map<string | number, boolean>()
  const messageKeys = new Map<Message<T>, string | number>()
  let usesKnownBaseline = true

  for (const message of messages) {
    if (isMustRefetchMessage(message)) {
      presence.clear()
      usesKnownBaseline = false
      validatesResume = false
      continue
    }
    if (!isChangeMessage(message)) continue

    const rowId = getKey(message.value)
    messageKeys.set(message, rowId)
    const operation = message.headers.operation
    if (operation === `delete`) {
      presence.set(rowId, false)
      continue
    }

    const isKnown =
      presence.get(rowId) ?? (usesKnownBaseline && hasKnownKey(rowId))
    if (validatesResume && operation === `update` && !isKnown) {
      return { messageKeys, hasUnseenUpdate: true }
    }
    presence.set(rowId, true)
  }

  return { messageKeys, hasUnseenUpdate: false }
}

function isSnapshotEndMessage<T extends Row<unknown>>(
  message: Message<T>,
): message is SnapshotEndMessage {
  return isControlMessage(message) && message.headers.control === `snapshot-end`
}

function isSubsetEndMessage<T extends Row<unknown>>(
  message: Message<T>,
): message is ControlMessage & { headers: { control: `subset-end` } } {
  return (
    isControlMessage(message) &&
    (message.headers.control as string) === `subset-end`
  )
}

function parseSnapshotMessage(message: SnapshotEndMessage): PostgresSnapshot {
  return {
    xmin: message.headers.xmin,
    xmax: message.headers.xmax,
    xip_list: message.headers.xip_list,
  }
}

function toStableSerializable(value: unknown): unknown {
  if (value == null) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toStableSerializable(entry))
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === `object`) {
    const record = value as Record<string, unknown>
    const stableRecord: Record<string, unknown> = {}
    const keys = Object.keys(record).sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    )
    for (const key of keys) {
      stableRecord[key] = toStableSerializable(record[key])
    }
    return stableRecord
  }

  return value
}

function getStableShapeIdentity(shapeOptions: {
  url: string
  params?: Record<string, unknown>
}): string {
  return JSON.stringify(
    toStableSerializable({
      url: shapeOptions.url,
      params: shapeOptions.params ?? null,
    }),
  )
}

// Check if a message contains txids in its headers
function hasTxids<T extends Row<unknown>>(
  message: Message<T>,
): message is Message<T> & { headers: { txids?: Array<Txid> } } {
  return `txids` in message.headers && Array.isArray(message.headers.txids)
}

/**
 * Creates a deduplicated loadSubset handler for progressive/on-demand modes
 * Returns null for eager mode, or a DeduplicatedLoadSubset instance for other modes.
 * Handles fetching snapshots in progressive mode during buffering phase,
 * and requesting snapshots in on-demand mode.
 *
 * When cursor expressions are provided (whereFrom/whereCurrent), makes two
 * requestSnapshot calls:
 * - One for whereFrom (rows > cursor) with limit
 * - One for whereCurrent (rows = cursor, for tie-breaking) without limit
 */
function createLoadSubsetDedupe<T extends Row<unknown>>({
  stream,
  syncMode,
  isBufferingInitialSync,
  begin,
  write,
  commit,
  getCommitCursor,
  waitForCommitsAfter,
  onLoadSubset,
  collectionId,
  encodeColumnName,
  signal,
}: {
  stream: ShapeStream<T>
  syncMode: ElectricSyncMode
  isBufferingInitialSync: () => boolean
  begin: () => void
  write: (mutation: {
    type: `insert` | `update` | `delete`
    value: T
    metadata: Record<string, unknown>
  }) => void
  commit: (signal?: AbortSignal) => SyncAppliedReceipt
  getCommitCursor: () => number
  waitForCommitsAfter: (cursor: number) => Promise<void>
  onLoadSubset?: () => void
  collectionId?: string
  /**
   * Optional function to encode column names (e.g., camelCase to snake_case).
   * This is typically the `encode` function from shapeOptions.columnMapper.
   */
  encodeColumnName?: ColumnEncoder
  /**
   * Abort signal to check if the stream has been aborted during cleanup.
   * When aborted, errors from requestSnapshot are silently ignored.
   */
  signal: AbortSignal
}): DeduplicatedLoadSubset | null {
  if (syncMode === `eager`) {
    return null
  }

  const compileOptions = encodeColumnName ? { encodeColumnName } : undefined
  const logPrefix = collectionId ? `[${collectionId}] ` : ``

  /**
   * Handles errors from snapshot operations. Returns true if the error was
   * handled (signal aborted during cleanup), false if it should be re-thrown.
   */
  function handleSnapshotError(error: unknown, operation: string): boolean {
    if (signal.aborted) {
      debug(`${logPrefix}Ignoring ${operation} error during cleanup: %o`, error)
      return true
    }
    debug(`${logPrefix}Error in ${operation}: %o`, error)
    return false
  }

  const loadSubset = async (opts: LoadSubsetOptions) => {
    onLoadSubset?.()
    const commitCursor = getCommitCursor()
    if (opts.signal?.aborted) return

    if (isBufferingInitialSync()) {
      const snapshotParams = compileSQL<T>(opts, compileOptions)
      try {
        const { data: rows } = await stream.fetchSnapshot(snapshotParams)
        if (opts.signal?.aborted || !isBufferingInitialSync()) {
          debug(`${logPrefix}Ignoring snapshot - sync completed while fetching`)
          return
        }

        if (rows.length > 0) {
          begin()
          for (const row of rows) {
            write({
              type: `insert`,
              value: row.value,
              metadata: { ...row.headers },
            })
          }
          await commit(opts.signal)
          debug(`${logPrefix}Applied snapshot with ${rows.length} rows`)
        }
      } catch (error) {
        if (opts.signal?.aborted) return
        if (handleSnapshotError(error, `fetchSnapshot`)) {
          return
        }
        throw error
      }
      return
    }

    if (syncMode === `progressive`) {
      return
    }

    const { cursor, where, orderBy, limit } = opts

    // When the stream is already up-to-date, it may be in a long-poll wait.
    // Forcing a disconnect-and-refresh ensures requestSnapshot gets a response
    // from a fresh server round-trip rather than waiting for the current poll to end.
    // Some native fetch implementations (notably React Native/Expo) may not abort
    // long-poll requests promptly. Bound the wait so on-demand live queries don't
    // remain loading until the long-poll naturally times out.
    // If the refresh fails or times out, we fall through to requestSnapshot which
    // still works.
    if (stream.isUpToDate) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          stream.forceDisconnectAndRefresh(),
          new Promise<void>((resolve) => {
            timeoutId = setTimeout(
              resolve,
              FORCE_DISCONNECT_AND_REFRESH_TIMEOUT_MS,
            )
          }),
        ])
      } catch (error) {
        if (handleSnapshotError(error, `forceDisconnectAndRefresh`)) {
          return
        }
        debug(
          `${logPrefix}forceDisconnectAndRefresh failed, proceeding to requestSnapshot: %o`,
          error,
        )
      } finally {
        clearTimeout(timeoutId)
      }
    }

    if (opts.signal?.aborted) return

    // Upstream limitation: ShapeStream.requestSnapshot() publishes its rows
    // through the stream callback before its Promise resolves. It accepts no
    // request signal and exposes no request identity on those messages, so an
    // aborted request can already have installed rows before the check below.
    // Full request-scoped cancellation requires support in the Electric client;
    // matching snapshots by parameters is unsafe for overlapping equal requests.
    try {
      if (cursor) {
        const whereCurrentOpts: LoadSubsetOptions = {
          where: where ? and(where, cursor.whereCurrent) : cursor.whereCurrent,
          orderBy,
        }
        const whereCurrentParams = compileSQL<T>(
          whereCurrentOpts,
          compileOptions,
        )

        const whereFromOpts: LoadSubsetOptions = {
          where: where ? and(where, cursor.whereFrom) : cursor.whereFrom,
          orderBy,
          limit,
        }
        const whereFromParams = compileSQL<T>(whereFromOpts, compileOptions)

        debug(`${logPrefix}Requesting cursor.whereCurrent snapshot (all ties)`)
        debug(
          `${logPrefix}Requesting cursor.whereFrom snapshot (with limit ${limit})`,
        )

        await Promise.all([
          stream.requestSnapshot(whereCurrentParams),
          stream.requestSnapshot(whereFromParams),
        ])
      } else {
        const snapshotParams = compileSQL<T>(opts, compileOptions)
        await stream.requestSnapshot(snapshotParams)
      }
    } catch (error) {
      if (opts.signal?.aborted) return
      if (handleSnapshotError(error, `requestSnapshot`)) {
        return
      }
      throw error
    }
    await waitForCommitsAfter(commitCursor)
  }

  return new DeduplicatedLoadSubset({ loadSubset })
}

/**
 * Type for the awaitTxId utility function
 */
export type AwaitTxIdFn = (txId: Txid, timeout?: number) => Promise<boolean>

/**
 * Type for the awaitMatch utility function
 */
export type AwaitMatchFn<T extends Row<unknown>> = (
  matchFn: MatchFunction<T>,
  timeout?: number,
) => Promise<boolean>

/**
 * Electric collection utilities type
 */
export interface ElectricCollectionUtils<
  T extends Row<unknown> = Row<unknown>,
> extends UtilsRecord {
  awaitTxId: AwaitTxIdFn
  awaitMatch: AwaitMatchFn<T>
}

/** Owns evidence and pending work for one materialized Collection. */
class ElectricLifecycle<T extends Row<unknown>> {
  private readonly evidence: ElectricLifecycleEvidence = {
    seenTxids: new Set(),
    seenSnapshots: [],
  }

  private readonly pendingMatches = new Map<number, ElectricPendingMatch<T>>()
  private readonly pendingTxidWaits = new Map<
    number,
    {
      txId: Txid
      resolve: (value: boolean) => void
      reject: (error: Error) => void
      timeoutId: ReturnType<typeof setTimeout>
    }
  >()
  private matchBuffer: ElectricMatchBuffer<T> = {
    committedMessages: [],
    pendingMessages: [],
  }
  private nextWaiterId = 0
  private epoch = 0
  private active = false

  constructor(private readonly collectionId?: string) {}

  readonly utils: ElectricCollectionUtils<T> = {
    awaitTxId: (txId, timeout) => this.awaitTxId(txId, timeout),
    awaitMatch: (matchFn, timeout) => this.awaitMatch(matchFn, timeout),
  }

  start(): number {
    if (this.active) this.retire()
    this.active = true
    this.epoch++
    this.matchBuffer = { committedMessages: [], pendingMessages: [] }
    return this.epoch
  }

  isActive(epoch: number): boolean {
    return this.active && this.epoch === epoch
  }

  retire(epoch?: number): void {
    if (epoch !== undefined && !this.isActive(epoch)) return
    this.active = false
    this.epoch++

    for (const match of this.pendingMatches.values()) {
      clearTimeout(match.timeoutId)
      match.reject(new StreamAbortedError(this.collectionId))
    }
    this.pendingMatches.clear()

    for (const waiter of this.pendingTxidWaits.values()) {
      clearTimeout(waiter.timeoutId)
      waiter.reject(new StreamAbortedError(this.collectionId))
    }
    this.pendingTxidWaits.clear()
    this.matchBuffer = { committedMessages: [], pendingMessages: [] }
    this.evidence.hydratedResumeState = undefined
  }

  exportMeta(): ElectricSyncMeta {
    return exportElectricSyncMeta(this.evidence)
  }

  importMeta(meta: unknown): void {
    importElectricSyncMeta(this.evidence, meta)
    this.resolveTxidWaiters()
  }

  get resumeState(): ElectricResumeState | undefined {
    return this.evidence.hydratedResumeState
  }

  set resumeState(value: ElectricResumeState | undefined) {
    this.evidence.hydratedResumeState = value
  }

  publishEvidence(
    txids: ReadonlySet<Txid>,
    snapshots: ReadonlyArray<PostgresSnapshot>,
  ): void {
    txids.forEach((txid) => this.evidence.seenTxids.add(txid))
    this.evidence.seenSnapshots.push(...snapshots)
    this.resolveTxidWaiters()
  }

  private hasTxid(txId: Txid): boolean {
    return (
      this.evidence.seenTxids.has(txId) ||
      this.evidence.seenSnapshots.some((snapshot) =>
        isVisibleInSnapshot(txId, snapshot),
      )
    )
  }

  private resolveTxidWaiters(): void {
    for (const [waitId, waiter] of this.pendingTxidWaits) {
      if (!this.hasTxid(waiter.txId)) continue
      clearTimeout(waiter.timeoutId)
      this.pendingTxidWaits.delete(waitId)
      waiter.resolve(true)
    }
  }

  private async awaitTxId(
    txId: Txid,
    timeout: number = 5000,
  ): Promise<boolean> {
    debug(
      `${this.collectionId ? `[${this.collectionId}] ` : ``}awaitTxId called with txid %d`,
      txId,
    )
    if (typeof txId !== `number`) {
      throw new ExpectedNumberInAwaitTxIdError(typeof txId, this.collectionId)
    }
    if (this.hasTxid(txId)) return true

    return new Promise((resolve, reject) => {
      const waitId = this.nextWaiterId++
      const timeoutId = setTimeout(() => {
        this.pendingTxidWaits.delete(waitId)
        reject(new TimeoutWaitingForTxIdError(txId, this.collectionId))
      }, timeout)
      this.pendingTxidWaits.set(waitId, {
        txId,
        resolve,
        reject,
        timeoutId,
      })
    })
  }

  private async awaitMatch(
    matchFn: MatchFunction<T>,
    timeout: number = 3000,
  ): Promise<boolean> {
    debug(
      `${this.collectionId ? `[${this.collectionId}] ` : ``}awaitMatch called with custom function`,
    )

    for (const message of this.matchBuffer.committedMessages) {
      if (!matchFn(message)) continue
      return true
    }
    for (const message of this.matchBuffer.pendingMessages) {
      if (matchFn(message)) return this.registerMatch(matchFn, timeout, true)
    }
    return this.registerMatch(matchFn, timeout, false)
  }

  private registerMatch(
    matchFn: MatchFunction<T>,
    timeout: number,
    matched: boolean,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const matchId = this.nextWaiterId++
      const timeoutId = setTimeout(() => {
        this.pendingMatches.delete(matchId)
        reject(new TimeoutWaitingForMatchError(this.collectionId))
      }, timeout)
      this.pendingMatches.set(matchId, {
        matchFn,
        resolve,
        reject,
        timeoutId,
        matched,
      })
    })
  }

  beginMatchGeneration(messages: ReadonlyArray<Message<T>>): void {
    if (!messages.some(isMustRefetchMessage)) return
    this.matchBuffer = { committedMessages: [], pendingMessages: [] }
    for (const match of this.pendingMatches.values()) match.matched = false
  }

  observeMatchMessage(message: Message<T>): void {
    if (
      isChangeMessage(message) ||
      isMoveOutMessage(message) ||
      isMoveInMessage(message)
    ) {
      this.matchBuffer.pendingMessages.push(message)
      let overflow =
        this.matchBuffer.committedMessages.length +
        this.matchBuffer.pendingMessages.length -
        1000
      if (overflow > 0) {
        const committedOverflow = Math.min(
          overflow,
          this.matchBuffer.committedMessages.length,
        )
        this.matchBuffer.committedMessages.splice(0, committedOverflow)
        overflow -= committedOverflow
        if (overflow > 0) {
          this.matchBuffer.pendingMessages.splice(0, overflow)
        }
      }
    }

    for (const [matchId, match] of this.pendingMatches) {
      if (match.matched) continue
      try {
        match.matched = match.matchFn(message)
      } catch (error) {
        clearTimeout(match.timeoutId)
        this.pendingMatches.delete(matchId)
        match.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  commitMatches(): void {
    this.matchBuffer.committedMessages.push(...this.matchBuffer.pendingMessages)
    this.matchBuffer.pendingMessages = []
    if (this.matchBuffer.committedMessages.length > 1000) {
      this.matchBuffer.committedMessages.splice(
        0,
        this.matchBuffer.committedMessages.length - 1000,
      )
    }
    for (const [matchId, match] of this.pendingMatches) {
      if (!match.matched) continue
      clearTimeout(match.timeoutId)
      this.pendingMatches.delete(matchId)
      match.resolve(true)
    }
  }
}

/**
 * Creates Electric collection options for use with a standard Collection
 *
 * @template T - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 * @param config - Configuration options for the Electric collection
 * @returns Collection options with utilities
 */

// Overload for when schema is provided
export function electricCollectionOptions<T extends StandardSchemaV1>(
  config: ElectricCollectionConfig<InferSchemaOutput<T>, T> & {
    schema: T
  },
): Omit<
  CollectionConfig<InferSchemaOutput<T>, string | number, T>,
  `utils` | `onInsert` | `onUpdate` | `onDelete`
> &
  Pick<
    ElectricCollectionConfig<InferSchemaOutput<T>, T>,
    `onInsert` | `onUpdate` | `onDelete`
  > & {
    id?: string
    utils: ElectricCollectionUtils<InferSchemaOutput<T>>
    schema: T
  }

// Overload for when no schema is provided
export function electricCollectionOptions<T extends Row<unknown>>(
  config: ElectricCollectionConfig<T> & {
    schema?: never // prohibit schema
  },
): Omit<
  CollectionConfig<T, string | number>,
  `utils` | `onInsert` | `onUpdate` | `onDelete`
> &
  Pick<ElectricCollectionConfig<T>, `onInsert` | `onUpdate` | `onDelete`> & {
    id?: string
    utils: ElectricCollectionUtils<T>
    schema?: never // no schema in the result
  }

export function electricCollectionOptions<T extends Row<unknown>>(
  config: ElectricCollectionConfig<T, any>,
): Omit<
  CollectionConfig<T, string | number, any, ElectricCollectionUtils<T>>,
  `utils`
> & {
  id?: string
  utils: ElectricCollectionUtils<T>
  schema?: any
} {
  let descriptorLifecycle = new ElectricLifecycle<T>(config.id)
  let utilityLifecycle = descriptorLifecycle
  const internalSyncMode = config.syncMode ?? `eager`
  const finalSyncMode =
    internalSyncMode === `progressive` ? `on-demand` : internalSyncMode
  const boundLifecycles = new WeakMap<object, ElectricLifecycle<T>>()
  const awaitTxId: AwaitTxIdFn = (txId, timeout) =>
    utilityLifecycle.utils.awaitTxId(txId, timeout)

  const awaitMatch: AwaitMatchFn<T> = (matchFn, timeout) =>
    utilityLifecycle.utils.awaitMatch(matchFn, timeout)

  const createSync = () =>
    createElectricSync<T>(config.shapeOptions, {
      getLifecycle: (collection) =>
        boundLifecycles.get(collection) ?? descriptorLifecycle,
      syncMode: internalSyncMode,
      collectionId: config.id,
      testHooks: config[ELECTRIC_TEST_HOOKS],
    })
  const sync = createSync()

  /**
   * Process matching strategy and wait for synchronization
   */
  const processMatchingStrategy = async (
    result: MatchingStrategy,
    waitForTxId: AwaitTxIdFn,
  ): Promise<void> => {
    // Only wait if result contains txid
    if (result && `txid` in result) {
      const timeout = result.timeout
      // Handle both single txid and array of txids
      if (Array.isArray(result.txid)) {
        await Promise.all(result.txid.map((txid) => waitForTxId(txid, timeout)))
      } else {
        await waitForTxId(result.txid, timeout)
      }
    }
    // If result is void/undefined, don't wait - mutation completes immediately
  }
  const getMutationAwaitTxId = (params: unknown): AwaitTxIdFn => {
    const collection = (
      params as {
        collection?: { utils?: { awaitTxId?: AwaitTxIdFn } }
      }
    ).collection
    return collection?.utils?.awaitTxId ?? awaitTxId
  }

  // Create wrapper handlers for direct persistence operations that handle different matching strategies
  const wrappedOnInsert = config.onInsert
    ? async (
        params: InsertMutationFnParams<
          any,
          string | number,
          ElectricCollectionUtils<T>
        >,
      ) => {
        const handlerResult = await config.onInsert!(params)
        await processMatchingStrategy(
          handlerResult,
          getMutationAwaitTxId(params),
        )
        return handlerResult
      }
    : undefined

  const wrappedOnUpdate = config.onUpdate
    ? async (
        params: UpdateMutationFnParams<
          any,
          string | number,
          ElectricCollectionUtils<T>
        >,
      ) => {
        const handlerResult = await config.onUpdate!(params)
        await processMatchingStrategy(
          handlerResult,
          getMutationAwaitTxId(params),
        )
        return handlerResult
      }
    : undefined

  const wrappedOnDelete = config.onDelete
    ? async (
        params: DeleteMutationFnParams<
          any,
          string | number,
          ElectricCollectionUtils<T>
        >,
      ) => {
        const handlerResult = await config.onDelete!(params)
        await processMatchingStrategy(
          handlerResult,
          getMutationAwaitTxId(params),
        )
        return handlerResult
      }
    : undefined

  // Extract standard Collection config properties
  const {
    shapeOptions: _shapeOptions,
    onInsert: _onInsert,
    onUpdate: _onUpdate,
    onDelete: _onDelete,
    ...restConfig
  } = config

  const utilityTemplate: ElectricCollectionUtils<T> = {
    awaitTxId,
    awaitMatch,
  }
  const consumeDescriptorLifecycle = (): ElectricLifecycle<T> => {
    const lifecycle = descriptorLifecycle
    descriptorLifecycle = new ElectricLifecycle<T>(config.id)
    utilityLifecycle = lifecycle
    return lifecycle
  }
  const createBoundSync = (
    source: SyncConfig<T>,
    utilities: object,
  ): SyncConfig<T> => {
    const lifecycle = consumeDescriptorLifecycle()
    let collectionKey: object | undefined
    Object.assign(utilities, lifecycle.utils)

    const boundSync: SyncConfig<T> = {
      ...source,
      sync: (params) => {
        collectionKey = params.collection
        boundLifecycles.set(params.collection, lifecycle)
        return source.sync(params)
      },
      exportSyncMeta: () => lifecycle.exportMeta(),
      importSyncMeta: (meta) => lifecycle.importMeta(meta),
      mergeSyncMeta: mergeElectricSyncMeta,
    }
    return withCollectionSyncConfigCleanup(boundSync, () => {
      lifecycle.retire()
      if (collectionKey) boundLifecycles.delete(collectionKey)
    })
  }
  const syncTemplate = withCollectionSyncConfigFactory(
    {
      ...sync,
      exportSyncMeta: () => descriptorLifecycle.exportMeta(),
      importSyncMeta: (meta) => descriptorLifecycle.importMeta(meta),
      mergeSyncMeta: mergeElectricSyncMeta,
    },
    createBoundSync,
  )
  const options = {
    ...restConfig,
    syncMode: finalSyncMode,
    sync: syncTemplate,
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils: utilityTemplate,
  }
  Object.defineProperty(options, `utils`, {
    enumerable: true,
    get: () => ({ ...utilityTemplate }),
  })

  return withCollectionConfigFactory(options, () =>
    (
      electricCollectionOptions as (
        nextConfig: ElectricCollectionConfig<T, any>,
      ) => typeof options
    )(config),
  )
}

/**
 * Internal function to create ElectricSQL sync configuration
 */
function createElectricSync<T extends Row<unknown>>(
  shapeOptions: ShapeStreamOptions<GetExtensions<T>>,
  options: {
    syncMode: ElectricSyncMode
    getLifecycle: (collection: object) => ElectricLifecycle<T>
    collectionId?: string
    testHooks?: ElectricTestHooks
  },
): SyncConfig<T> {
  const { getLifecycle, syncMode, collectionId, testHooks } = options

  let relationSchema: string | undefined

  const tagCache = new Map<MoveTag, ParsedMoveTag>()

  // Parses a tag string into a ParsedMoveTag.
  // It memoizes the result parsed tag such that future calls
  // for the same tag string return the same ParsedMoveTag array.
  const parseTag = (tag: MoveTag): ParsedMoveTag => {
    const cachedTag = tagCache.get(tag)
    if (cachedTag) {
      return cachedTag
    }

    const parsedTag = parseTagString(tag)
    tagCache.set(tag, parsedTag)
    return parsedTag
  }

  // Tag tracking state
  const rowTagSets = new Map<RowId, Set<MoveTag>>()
  const tagIndex: TagIndex = []
  let tagLength: number | undefined = undefined

  // DNF state: active_conditions are per-row, disjunct_positions are global
  // (fixed by the shape's WHERE clause, derived once from the first tagged message).
  const rowActiveConditions = new Map<RowId, ActiveConditions>()
  let disjunctPositions: DisjunctPositions | undefined = undefined

  /**
   * Initialize the tag index with the correct length
   */
  const initializeTagIndex = (length: number): void => {
    if (tagIndex.length < length) {
      // Extend the index array to the required length
      for (let i = tagIndex.length; i < length; i++) {
        tagIndex[i] = new Map()
      }
    }
  }

  /**
   * Add tags to a row and update the tag index
   */
  const addTagsToRow = (
    tags: Array<MoveTag>,
    rowId: RowId,
    rowTagSet: Set<MoveTag>,
  ): void => {
    for (const tag of tags) {
      const parsedTag = parseTag(tag)

      // Infer tag length from first tag
      if (tagLength === undefined) {
        tagLength = getTagLength(parsedTag)
        initializeTagIndex(tagLength)
      }

      // Validate tag length matches
      const currentTagLength = getTagLength(parsedTag)
      if (currentTagLength !== tagLength) {
        debug(
          `${collectionId ? `[${collectionId}] ` : ``}Tag length mismatch: expected ${tagLength}, got ${currentTagLength}`,
        )
        continue
      }

      rowTagSet.add(tag)
      addTagToIndex(parsedTag, rowId, tagIndex, tagLength)
    }
  }

  /**
   * Remove tags from a row and update the tag index
   */
  const removeTagsFromRow = (
    removedTags: Array<MoveTag>,
    rowId: RowId,
    rowTagSet: Set<MoveTag>,
  ): void => {
    if (tagLength === undefined) {
      return
    }

    for (const tag of removedTags) {
      const parsedTag = parseTag(tag)
      rowTagSet.delete(tag)
      removeTagFromIndex(parsedTag, rowId, tagIndex, tagLength)
      // We aggresively evict the tag from the cache
      // if this tag is shared with another row
      // and is not removed from that other row
      // then next time we encounter the tag it will be parsed again
      tagCache.delete(tag)
    }
  }

  /**
   * Process tags for a change message (add and remove tags)
   */
  const processTagsForChangeMessage = (
    tags: Array<MoveTag> | undefined,
    removedTags: Array<MoveTag> | undefined,
    rowId: RowId,
    activeConditions?: ActiveConditions,
  ): Set<MoveTag> => {
    // Initialize tag set for this row if it doesn't exist (needed for checking deletion)
    if (!rowTagSets.has(rowId)) {
      rowTagSets.set(rowId, new Set())
    }
    const rowTagSet = rowTagSets.get(rowId)!

    // Add new tags
    if (tags) {
      addTagsToRow(tags, rowId, rowTagSet)

      // Derive disjunct positions once — they are fixed by the shape's WHERE clause.
      if (disjunctPositions === undefined) {
        const parsedTags = tags.map(parseTag)
        disjunctPositions = deriveDisjunctPositions(parsedTags)
      }
    }

    // Remove tags
    if (removedTags) {
      removeTagsFromRow(removedTags, rowId, rowTagSet)
    }

    // Store active conditions if provided (overwrite on re-send)
    if (activeConditions && activeConditions.length > 0) {
      rowActiveConditions.set(rowId, [...activeConditions])
    }

    return rowTagSet
  }

  /**
   * Clear all tag tracking state (used when truncating)
   */
  const clearTagTrackingState = (): void => {
    rowTagSets.clear()
    tagIndex.length = 0
    tagLength = undefined
    rowActiveConditions.clear()
    disjunctPositions = undefined
  }

  /**
   * Remove all tags for a row from both the tag set and the index
   * Used when a row is deleted
   */
  const clearTagsForRow = (rowId: RowId): void => {
    if (tagLength === undefined) {
      return
    }

    const rowTagSet = rowTagSets.get(rowId)
    if (!rowTagSet) {
      return
    }

    // Remove each tag from the index
    for (const tag of rowTagSet) {
      const parsedTag = parseTag(tag)
      const currentTagLength = getTagLength(parsedTag)
      if (currentTagLength === tagLength) {
        removeTagFromIndex(parsedTag, rowId, tagIndex, tagLength)
      }
      tagCache.delete(tag)
    }

    // Remove the row from the tag sets map
    rowTagSets.delete(rowId)
    rowActiveConditions.delete(rowId)
  }

  /**
   * Remove matching tags from a row based on a pattern
   * Returns true if the row should be deleted (no longer visible)
   */
  const removeMatchingTagsFromRow = (
    rowId: RowId,
    pattern: MovePattern,
  ): boolean => {
    const rowTagSet = rowTagSets.get(rowId)
    if (!rowTagSet) {
      return false
    }

    // DNF mode: check visibility using active conditions.
    // Tag index entries are preserved so that move-in can re-activate positions.
    const activeConditions = rowActiveConditions.get(rowId)
    if (activeConditions && disjunctPositions) {
      // Set the condition at this pattern's position to false
      activeConditions[pattern.pos] = false

      if (!rowVisible(activeConditions, disjunctPositions)) {
        // Row is no longer visible — clean up all state including tag index
        for (const tag of rowTagSet) {
          const parsedTag = parseTag(tag)
          removeTagFromIndex(parsedTag, rowId, tagIndex, tagLength!)
          tagCache.delete(tag)
        }
        rowTagSets.delete(rowId)
        rowActiveConditions.delete(rowId)
        return true
      }
      return false
    }

    // Simple shape (no subquery dependencies — server sends no active_conditions):
    // Remove matching tags and delete if tag set is empty
    for (const tag of rowTagSet) {
      const parsedTag = parseTag(tag)
      if (tagMatchesPattern(parsedTag, pattern)) {
        rowTagSet.delete(tag)
        removeTagFromIndex(parsedTag, rowId, tagIndex, tagLength!)
      }
    }

    if (rowTagSet.size === 0) {
      rowTagSets.delete(rowId)
      return true
    }

    return false
  }

  /**
   * Process move-out event: remove matching tags from rows and delete rows with empty tag sets
   */
  const processMoveOutEvent = (
    patterns: Array<MovePattern>,
    begin: () => void,
    write: (message: ChangeMessageOrDeleteKeyMessage<T>) => void,
    transactionStarted: boolean,
    onDelete: (rowId: RowId) => void,
  ): boolean => {
    if (tagLength === undefined) {
      debug(
        `${collectionId ? `[${collectionId}] ` : ``}Received move-out message but no tag length set yet, ignoring`,
      )
      return transactionStarted
    }

    let txStarted = transactionStarted

    // Process all patterns and collect rows to delete
    for (const pattern of patterns) {
      // Find all rows that match this pattern
      const affectedRowIds = findRowsMatchingPattern(pattern, tagIndex)

      for (const rowId of affectedRowIds) {
        if (removeMatchingTagsFromRow(rowId, pattern)) {
          // Delete rows with empty tag sets
          if (!txStarted) {
            begin()
            txStarted = true
          }

          write({
            type: `delete`,
            key: rowId,
          })
          onDelete(rowId)
        }
      }
    }

    return txStarted
  }

  /**
   * Process move-in event: re-activate conditions for rows matching the patterns.
   * This is a silent operation — no messages are emitted to the collection.
   */
  const processMoveInEvent = (patterns: Array<MovePattern>): void => {
    if (tagLength === undefined) {
      debug(
        `${collectionId ? `[${collectionId}] ` : ``}Received move-in message but no tag length set yet, ignoring`,
      )
      return
    }

    for (const pattern of patterns) {
      const affectedRowIds = findRowsMatchingPattern(pattern, tagIndex)

      for (const rowId of affectedRowIds) {
        const activeConditions = rowActiveConditions.get(rowId)
        if (activeConditions) {
          activeConditions[pattern.pos] = true
        }
      }
    }
  }

  /**
   * Get the sync metadata for insert operations
   * @returns Record containing relation information
   */
  const getSyncMetadata = (): Record<string, unknown> => {
    // Use the stored schema if available, otherwise default to 'public'
    const schema = relationSchema || `public`

    return {
      relation: shapeOptions.params?.table
        ? [schema, shapeOptions.params.table]
        : undefined,
    }
  }

  return {
    sync: (params: Parameters<SyncConfig<T>[`sync`]>[0]) => {
      const lifecycle = getLifecycle(params.collection)
      const lifecycleEpoch = lifecycle.start()
      const isActiveLifecycle = () => lifecycle.isActive(lifecycleEpoch)
      Object.assign(params.collection.utils, lifecycle.utils)

      const {
        begin,
        write,
        commit: commitSyncTransaction,
        markReady,
        markError,
        truncate,
        collection,
        metadata,
      } = params
      let commitSequence = 0
      const pendingAppliedReceipts = new Map<number, Promise<void>>()
      const commit = (signal?: AbortSignal): SyncAppliedReceipt => {
        const sequence = ++commitSequence
        const applied = commitSyncTransaction(signal)
        if (applied === true) {
          return true
        }
        pendingAppliedReceipts.set(sequence, applied)
        const removeReceipt = () => pendingAppliedReceipts.delete(sequence)
        void applied.then(removeReceipt, removeReceipt)
        return applied
      }
      const waitForCommitsAfter = async (cursor: number): Promise<void> => {
        await Promise.all(
          Array.from(pendingAppliedReceipts, ([sequence, applied]) =>
            sequence > cursor ? applied : undefined,
          ),
        )
      }
      const readPersistedResumeState = (): ElectricResumeState | undefined => {
        const persistedResumeState = metadata?.collection.get(`electric:resume`)
        return parseElectricResumeState(persistedResumeState)
      }

      const persistedMetadata = metadata as
        | ElectricSyncMetadataWithPersistedScan
        | undefined
      const scanPersisted = persistedMetadata?.row.scanPersisted
      const whenHydrated = persistedMetadata?.row.whenHydrated

      const persistedResumeState = getNewestElectricResumeState(
        readPersistedResumeState(),
        lifecycle.resumeState,
      )
      const shapeIdentity = getStableShapeIdentity({
        url: shapeOptions.url,
        params: shapeOptions.params as Record<string, unknown> | undefined,
      })
      const hasIncompatiblePersistedResume =
        persistedResumeState?.kind === `resume` &&
        persistedResumeState.shapeId !== shapeIdentity
      const hasUnverifiablePersistedResume =
        shapeOptions.offset === undefined &&
        shapeOptions.handle === undefined &&
        persistedResumeState?.kind === `resume` &&
        scanPersisted !== undefined &&
        whenHydrated === undefined
      const canUsePersistedResume =
        shapeOptions.offset === undefined &&
        shapeOptions.handle === undefined &&
        persistedResumeState?.kind === `resume` &&
        !hasIncompatiblePersistedResume &&
        !hasUnverifiablePersistedResume
      const hasExplicitResumeOffset =
        shapeOptions.offset !== undefined && shapeOptions.offset !== `-1`
      const receivesCompleteRows = shapeOptions.params?.replica === `full`
      // Eager and progressive streams that start after the initial offset can
      // only apply partial updates when the local materialization is complete.
      const requiresCompleteResume =
        syncMode !== `on-demand` &&
        (canUsePersistedResume ||
          (hasExplicitResumeOffset && !receivesCompleteRows))

      // Wrap markReady to wait for test hook in progressive mode
      let progressiveReadyGate: Promise<void> | null = null
      let streamErrorVersion = 0
      const wrappedMarkReady = (
        isBuffering: boolean,
        expectedErrorVersion = streamErrorVersion,
      ) => {
        if (streamErrorVersion !== expectedErrorVersion) return

        // Only create gate if we're in buffering phase (first up-to-date)
        if (
          isBuffering &&
          syncMode === `progressive` &&
          testHooks?.beforeMarkingReady
        ) {
          // Create a new gate promise for this sync cycle
          progressiveReadyGate = testHooks.beforeMarkingReady()
          progressiveReadyGate.then(() => {
            if (streamErrorVersion === expectedErrorVersion) {
              markReady()
            }
          })
        } else {
          // No hook, not buffering, or already past first up-to-date
          markReady()
        }
      }

      // Abort controller for the stream - wraps the signal if provided
      const abortController = new AbortController()

      if (shapeOptions.signal) {
        shapeOptions.signal.addEventListener(
          `abort`,
          () => {
            abortController.abort()
          },
          {
            once: true,
          },
        )
        if (shapeOptions.signal.aborted) {
          abortController.abort()
        }
      }

      abortController.signal.addEventListener(`abort`, () => {
        lifecycle.retire(lifecycleEpoch)
      })

      const stream = new ShapeStream({
        ...shapeOptions,
        // In on-demand mode, we only want to sync changes, so we set the log to `changes_only`
        log: syncMode === `on-demand` ? `changes_only` : undefined,
        // In on-demand mode, we only need the changes from the point of time the collection was created
        // so we default to `now` when there is no saved offset.
        offset:
          shapeOptions.offset ??
          (canUsePersistedResume
            ? (persistedResumeState.offset as Offset)
            : syncMode === `on-demand`
              ? `now`
              : undefined),
        handle:
          shapeOptions.handle ??
          (canUsePersistedResume ? persistedResumeState.handle : undefined),
        signal: abortController.signal,
        onError: (errorParams) => {
          streamErrorVersion++
          // Note that Electric sends a 409 error on a `must-refetch` message, but the
          // ShapeStream handled this and it will not reach this handler, therefor
          // this handler will not run for a `must-refetch`.
          const initialSyncFailed = collection.status === `loading`
          if (initialSyncFailed) {
            markError(errorParams)
          }

          if (shapeOptions.onError) {
            return shapeOptions.onError(errorParams)
          } else {
            console.error(
              `An error occurred while syncing collection: ${collection.id}, \n` +
                (initialSyncFailed
                  ? `the initial sync has been marked as failed. \n`
                  : `the last ready snapshot has been preserved. \n`) +
                `You can provide an 'onError' handler on the shapeOptions to handle this error, and this message will not be logged.`,
              errorParams,
            )
          }

          return
        },
      })
      let transactionStarted = false
      const newTxids = new Set<Txid>()
      const newSnapshots: Array<PostgresSnapshot> = []
      // Track if we've completed initial sync in progressive mode. A persisted
      // resume starts from an already-committed stream offset, so the next
      // up-to-date message must not run the initial atomic swap again.
      let hasReceivedUpToDate =
        syncMode === `progressive` && requiresCompleteResume
      // A must-refetch starts a new snapshot generation. Until its up-to-date
      // commit is applied, old Collection keys cannot make an update valid and
      // the durable resume marker must remain reset.
      let isResettingSnapshot = false
      let resetGeneration = 0

      // Progressive mode state
      // Helper to determine if we're buffering the initial sync
      const isBufferingInitialSync = () =>
        syncMode === `progressive` &&
        !hasReceivedUpToDate &&
        !isResettingSnapshot
      const bufferedMessages: Array<Message<T>> = [] // Buffer change messages during initial sync

      // Track keys that have been synced to handle overlapping subset queries.
      // When multiple subset queries return the same row, the server sends `insert`
      // for each response. We convert subsequent inserts to updates to avoid
      // duplicate key errors when the row's data has changed between requests.
      const syncedKeys = new Set<string | number>()
      // This is the logical key set for the current stream generation. Unlike
      // collection.keys(), it includes uncommitted changes from earlier
      // callbacks, so accepting an update cannot depend on batch partitioning.
      const knownKeys = new Set<string | number>(
        collection._state.syncedData.keys(),
      )
      let resumeInvalid = false

      const stageResumeMetadata = () => {
        if (!isActiveLifecycle() || resumeInvalid) {
          return
        }
        const shapeHandle = stream.shapeHandle
        const lastOffset = stream.lastOffset
        if (!shapeHandle || lastOffset === `-1`) {
          return
        }

        const resumeState: ElectricResumeState = {
          kind: `resume`,
          offset: lastOffset,
          handle: shapeHandle,
          shapeId: shapeIdentity,
          updatedAt: Date.now(),
        }
        lifecycle.resumeState = resumeState
        metadata?.collection.set(`electric:resume`, resumeState)
      }

      const commitResetResumeMetadataImmediately = () => {
        const resetState: ElectricResumeState = {
          kind: `reset`,
          updatedAt: Date.now(),
        }
        lifecycle.resumeState = resetState

        if (metadata) {
          begin({ immediate: true })
          metadata.collection.set(`electric:resume`, resetState)
          commit()
        }
      }

      if (hasIncompatiblePersistedResume || hasUnverifiablePersistedResume) {
        commitResetResumeMetadataImmediately()
      }

      /**
       * Process a change message: handle tags and write the mutation
       */
      const processChangeMessage = (changeMessage: Message<T>) => {
        if (!isChangeMessage(changeMessage)) {
          return
        }

        // Process tags if present
        const tags = changeMessage.headers.tags
        const removedTags = changeMessage.headers.removed_tags
        const hasTags = tags || removedTags

        // Extract active_conditions from headers (DNF support)
        const activeConditions = changeMessage.headers.active_conditions as
          | ActiveConditions
          | undefined

        const rowId = collection.getKeyFromItem(changeMessage.value)
        const operation = changeMessage.headers.operation

        // Track synced keys and handle overlapping subset queries.
        // When multiple subset queries return the same row, the server sends
        // `insert` for each response. We convert subsequent inserts to updates
        // to avoid duplicate key errors when the row's data has changed.
        const isDelete = operation === `delete`
        const isDuplicateInsert =
          operation === `insert` && syncedKeys.has(rowId)

        if (isDelete) {
          syncedKeys.delete(rowId)
        } else {
          syncedKeys.add(rowId)
        }

        if (isDelete) {
          clearTagsForRow(rowId)
        } else if (hasTags) {
          processTagsForChangeMessage(
            tags,
            removedTags,
            rowId,
            activeConditions,
          )
        }

        write({
          type: isDuplicateInsert ? `update` : operation,
          value: changeMessage.value,
          // Include the primary key and relation info in the metadata
          metadata: {
            ...changeMessage.headers,
          },
        })
      }

      // Create deduplicated loadSubset wrapper for non-eager modes
      // This prevents redundant snapshot requests when multiple concurrent
      // live queries request overlapping or subset predicates
      const loadSubsetDedupe = createLoadSubsetDedupe({
        stream,
        syncMode,
        isBufferingInitialSync,
        begin,
        write,
        commit,
        getCommitCursor: () => commitSequence,
        waitForCommitsAfter,
        onLoadSubset: () => {
          for (const rowId of collection._state.syncedData.keys()) {
            knownKeys.add(rowId)
          }
        },
        collectionId,
        // Pass the columnMapper's encode function to transform column names
        // (e.g., camelCase to snake_case) when compiling SQL for subset queries
        encodeColumnName: shapeOptions.columnMapper?.encode,
        // Pass abort signal so requestSnapshot errors can be ignored during cleanup
        signal: abortController.signal,
      })

      const resumeKeysPromise = !requiresCompleteResume
        ? undefined
        : whenHydrated
          ? whenHydrated().then(() => [] as Array<{ key: string | number }>)
          : undefined
      let areResumeKeysReady = !requiresCompleteResume || !resumeKeysPromise
      const pendingResumeBatches: Array<Array<Message<T>>> = []
      let unsubscribeStream: () => void = () => {}

      const processMessages = (messages: Array<Message<T>>): void => {
        if (!isActiveLifecycle() || resumeInvalid) {
          return
        }

        // Plan against a sparse callback overlay. This keeps one-row live
        // updates O(batch size), regardless of the materialized row count.
        const { messageKeys, hasUnseenUpdate } = planBatchPresence(
          messages,
          (row) => collection.getKeyFromItem(row),
          (rowId) => knownKeys.has(rowId),
          requiresCompleteResume && !isResettingSnapshot,
        )

        // A resumed eager/progressive stream assumes its persisted rows form a
        // complete materialization at the saved offset. Electric updates only
        // carry changed columns, so applying one without a prior row would
        // create a durable partial row. Reject the whole batch and persist a
        // reset marker so the next sync starts from a full snapshot.
        if (requiresCompleteResume && hasUnseenUpdate) {
          resumeInvalid = true
          if (transactionStarted) {
            const cancellation = new AbortController()
            cancellation.abort()
            commit(cancellation.signal)
            transactionStarted = false
          }
          syncedKeys.clear()
          newTxids.clear()
          newSnapshots.length = 0
          commitResetResumeMetadataImmediately()
          streamErrorVersion++
          unsubscribeStream()
          abortController.abort()
          markError(
            new Error(
              `Electric resume state referenced an unseen row; a full snapshot is required`,
            ),
          )
          return
        }

        // Track commit point type - up-to-date takes precedence as it also triggers progressive mode atomic swap
        let commitPoint: `up-to-date` | `subset-end` | null = null

        lifecycle.beginMatchGeneration(messages)

        for (const message of messages) {
          lifecycle.observeMatchMessage(message)

          // Check for txids in the message and add them to our store
          // Skip during buffered initial sync in progressive mode (txids will be extracted during atomic swap)
          // EXCEPTION: If a transaction is already started (e.g., from must-refetch), track txids
          // to avoid losing them when messages are written to the existing transaction.
          if (
            hasTxids(message) &&
            (!isBufferingInitialSync() || transactionStarted)
          ) {
            message.headers.txids?.forEach((txid) => newTxids.add(txid))
          }

          if (isChangeMessage(message)) {
            const rowId = messageKeys.get(message)!
            const operation = message.headers.operation
            if (
              operation === `update` &&
              !receivesCompleteRows &&
              !knownKeys.has(rowId)
            ) {
              continue
            }
            if (operation === `delete`) {
              knownKeys.delete(rowId)
            } else {
              knownKeys.add(rowId)
            }
          }

          if (isChangeMessage(message)) {
            // Check if the message contains schema information
            const schema = message.headers.schema
            if (schema && typeof schema === `string`) {
              // Store the schema for future use if it's a valid string
              relationSchema = schema
            }

            // In buffered initial sync of progressive mode, buffer messages instead of writing
            // EXCEPTION: If a transaction is already started (e.g., from must-refetch), write
            // directly to it instead of buffering. This prevents orphan transactions.
            if (isBufferingInitialSync() && !transactionStarted) {
              bufferedMessages.push(message)
            } else {
              // Normal processing: write changes immediately
              if (!transactionStarted) {
                begin()
                transactionStarted = true
              }

              processChangeMessage(message)
            }
          } else if (isSnapshotEndMessage(message)) {
            // Track postgres snapshot metadata for resolving awaiting mutations
            // Skip during buffered initial sync (will be extracted during atomic swap)
            // EXCEPTION: If a transaction is already started (e.g., from must-refetch), track snapshots
            // to avoid losing them when messages are written to the existing transaction.
            if (!isBufferingInitialSync() || transactionStarted) {
              newSnapshots.push(parseSnapshotMessage(message))
            }
          } else if (isUpToDateMessage(message)) {
            // up-to-date takes precedence - also triggers progressive mode atomic swap
            commitPoint = `up-to-date`
          } else if (isSubsetEndMessage(message)) {
            // subset-end triggers commit but not progressive mode atomic swap
            if (commitPoint !== `up-to-date`) {
              commitPoint = `subset-end`
            }
          } else if (isMoveOutMessage(message)) {
            // Handle move-out event: buffer if buffering, otherwise process immediately
            // EXCEPTION: If a transaction is already started (e.g., from must-refetch), process
            // immediately to avoid orphan transactions.
            if (isBufferingInitialSync() && !transactionStarted) {
              bufferedMessages.push(message)
            } else {
              // Normal processing: process move-out immediately
              transactionStarted = processMoveOutEvent(
                message.headers.patterns,
                begin,
                write,
                transactionStarted,
                (rowId) => {
                  knownKeys.delete(rowId)
                  syncedKeys.delete(rowId)
                },
              )
            }
          } else if (isMoveInMessage(message)) {
            // Handle move-in event: re-activate conditions for matching rows.
            // Buffer if buffering, otherwise process immediately.
            if (isBufferingInitialSync() && !transactionStarted) {
              bufferedMessages.push(message)
            } else {
              processMoveInEvent(message.headers.patterns)
            }
          } else if (isMustRefetchMessage(message)) {
            debug(
              `${collectionId ? `[${collectionId}] ` : ``}Received must-refetch message, starting transaction with truncate`,
            )

            commitResetResumeMetadataImmediately()

            // Start a transaction and truncate the collection
            if (!transactionStarted) {
              begin()
              transactionStarted = true
            }

            truncate()

            // Clear tag tracking state
            clearTagTrackingState()

            // Clear synced keys tracking since we're starting fresh
            syncedKeys.clear()
            knownKeys.clear()
            isResettingSnapshot = true
            resetGeneration++

            // Reset the loadSubset deduplication state since we're starting fresh
            // This ensures that previously loaded predicates don't prevent refetching after truncate
            loadSubsetDedupe?.reset()

            // Reset flags so we continue accumulating changes until next up-to-date
            commitPoint = null
            hasReceivedUpToDate = false // Reset for progressive mode (isBufferingInitialSync will reflect this)
            bufferedMessages.length = 0 // Clear buffered messages
          }
        }

        if (commitPoint !== null) {
          let applied: SyncAppliedReceipt = true
          const wasBufferingInitialSync = isBufferingInitialSync()
          const finishesReset =
            isResettingSnapshot && commitPoint === `up-to-date`
          const finishingResetGeneration = resetGeneration
          // PROGRESSIVE MODE: Atomic swap on first up-to-date (not subset-end)
          // EXCEPTION: Skip atomic swap if a transaction is already started (e.g., from must-refetch).
          // In that case, do a normal commit to properly close the existing transaction.
          if (
            isBufferingInitialSync() &&
            commitPoint === `up-to-date` &&
            !transactionStarted
          ) {
            debug(
              `${collectionId ? `[${collectionId}] ` : ``}Progressive mode: Performing atomic swap with ${bufferedMessages.length} buffered messages`,
            )

            // Start atomic swap transaction
            begin()

            // Truncate to clear all snapshot data
            truncate()

            // Clear tag tracking state for atomic swap
            clearTagTrackingState()

            // Clear synced keys tracking for atomic swap
            syncedKeys.clear()

            // Apply all buffered change messages and extract txids/snapshots
            for (const bufferedMsg of bufferedMessages) {
              if (isChangeMessage(bufferedMsg)) {
                processChangeMessage(bufferedMsg)

                // Extract txids from buffered messages (will be committed to store after transaction)
                if (hasTxids(bufferedMsg)) {
                  bufferedMsg.headers.txids?.forEach((txid) =>
                    newTxids.add(txid),
                  )
                }
              } else if (isSnapshotEndMessage(bufferedMsg)) {
                // Extract snapshots from buffered messages (will be committed to store after transaction)
                newSnapshots.push(parseSnapshotMessage(bufferedMsg))
              } else if (isMoveOutMessage(bufferedMsg)) {
                // Process buffered move-out messages during atomic swap
                processMoveOutEvent(
                  bufferedMsg.headers.patterns,
                  begin,
                  write,
                  transactionStarted,
                  (rowId) => {
                    knownKeys.delete(rowId)
                    syncedKeys.delete(rowId)
                  },
                )
              } else if (isMoveInMessage(bufferedMsg)) {
                // Process buffered move-in messages during atomic swap
                processMoveInEvent(bufferedMsg.headers.patterns)
              }
            }

            // Commit the atomic swap
            stageResumeMetadata()
            applied = commit()

            // Exit buffering phase by marking that we've received up-to-date
            // isBufferingInitialSync() will now return false
            bufferedMessages.length = 0

            debug(
              `${collectionId ? `[${collectionId}] ` : ``}Progressive mode: Atomic swap complete, now in normal sync mode`,
            )
          } else {
            // Normal mode or on-demand: commit transaction if one was started
            // Both up-to-date and subset-end trigger a commit
            if (transactionStarted) {
              if (!isResettingSnapshot || finishesReset) {
                stageResumeMetadata()
              }
              applied = commit()
              transactionStarted = false
            } else if (commitPoint === `up-to-date` && metadata) {
              begin()
              stageResumeMetadata()
              applied = commit()
            }
          }
          const readyErrorVersion = streamErrorVersion
          if (applied === true) {
            wrappedMarkReady(wasBufferingInitialSync, readyErrorVersion)
          } else {
            void applied.then(
              () =>
                wrappedMarkReady(wasBufferingInitialSync, readyErrorVersion),
              () => undefined,
            )
          }

          if (finishesReset) {
            const finishReset = () => {
              if (resetGeneration === finishingResetGeneration) {
                isResettingSnapshot = false
              }
            }
            if (applied === true) {
              finishReset()
            } else {
              void applied.then(finishReset, () => undefined)
            }
          }

          // Track that we've received the first up-to-date for progressive mode
          if (commitPoint === `up-to-date`) {
            hasReceivedUpToDate = true
          }

          // Stream evidence is the acknowledgement boundary used by mutation
          // handlers. It must publish before a parked applied receipt or the
          // optimistic transaction and its acknowledgement can deadlock.
          if (newTxids.size > 0) {
            debug(
              `${collectionId ? `[${collectionId}] ` : ``}new txids synced from pg %O`,
              Array.from(newTxids),
            )
          }
          newSnapshots.forEach((snapshot) =>
            debug(
              `${collectionId ? `[${collectionId}] ` : ``}new snapshot synced from pg %o`,
              snapshot,
            ),
          )
          lifecycle.publishEvidence(newTxids, newSnapshots)
          newTxids.clear()
          newSnapshots.length = 0
          lifecycle.commitMatches()
        }
      }

      unsubscribeStream = stream.subscribe((messages: Array<Message<T>>) => {
        if (!areResumeKeysReady) {
          pendingResumeBatches.push([...messages])
          return
        }
        processMessages(messages)
      })

      if (!areResumeKeysReady && resumeKeysPromise) {
        void resumeKeysPromise.then(
          (rows) => {
            if (abortController.signal.aborted) return

            rows.forEach((row) => knownKeys.add(row.key))
            for (const rowId of collection._state.syncedData.keys()) {
              knownKeys.add(rowId)
            }
            areResumeKeysReady = true

            const queuedBatches = pendingResumeBatches.splice(0)
            queuedBatches.forEach(processMessages)
          },
          (error: unknown) => {
            if (abortController.signal.aborted) return

            pendingResumeBatches.length = 0
            resumeInvalid = true
            commitResetResumeMetadataImmediately()
            streamErrorVersion++
            unsubscribeStream()
            abortController.abort()
            markError(error)
          },
        )
      }

      // Return the deduplicated loadSubset if available (on-demand or progressive mode)
      // The loadSubset method is auto-bound, so it can be safely returned directly
      return {
        loadSubset: loadSubsetDedupe?.loadSubset,
        cleanup: () => {
          // Unsubscribe from the stream
          unsubscribeStream()
          // Abort the abort controller to stop the stream
          abortController.abort()
          pendingResumeBatches.length = 0
          // Reset deduplication tracking so collection can load fresh data if restarted
          loadSubsetDedupe?.reset()
          lifecycle.retire(lifecycleEpoch)
        },
      }
    },
    // Expose the getSyncMetadata function
    getSyncMetadata,
  }
}
