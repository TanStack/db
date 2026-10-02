import { deepEquals } from '../utils'
import { SortedMap } from '../SortedMap'
import { enrichRowWithVirtualProps } from '../virtual-props.js'
import { SyncTransactionAbortedError } from '../errors.js'
import { DIRECT_TRANSACTION_METADATA_KEY } from './transaction-metadata.js'
import type {
  VirtualOrigin,
  VirtualRowProps,
  WithVirtualProps,
} from '../virtual-props.js'
import type { Transaction } from '../transactions'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  ChangeMessage,
  CollectionConfig,
  OptimisticChangeMessage,
  PendingMutation,
} from '../types'
import type { CollectionImpl } from './index.js'
import type { CollectionLifecycleManager } from './lifecycle'
import type { CollectionChangesManager } from './changes'
import type { CollectionIndexesManager } from './indexes'
import type { CollectionEventsManager } from './events'
import type { Deferred } from '../deferred'
import type { DuplicateKeySyncError } from '../errors.js'

type PendingSyncOperation<
  T extends object,
  TKey extends string | number,
> = OptimisticChangeMessage<T, TKey> & {
  /** Preserve adapter intent when queue changes require reclassification. */
  originalSyncType?: `insert`
  /** A partial update admitted against a row must not become an upsert. */
  admittedAgainstExistingRow?: boolean
}

type PendingSyncedKeyState<T extends object> = {
  exists: boolean
  value: T | undefined
}

type PendingSyncedProjection<T extends object, TKey extends string | number> = {
  states: Map<TKey, PendingSyncedKeyState<T>>
  truncated: boolean
}

type PendingInsertDisposition = `insert` | `update` | `duplicate`

interface PendingSyncedTransaction<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> {
  committed: boolean
  applicationStarted: boolean
  layoutChanged: boolean
  operations: Array<PendingSyncOperation<T, TKey>>
  truncate?: boolean
  rowMetadataWrites: Map<TKey, PendingMetadataWrite>
  explicitRowMetadataWriteKeys?: Set<TKey>
  collectionMetadataWrites: Map<string, PendingMetadataWrite>
  /** Resolves after application and rejects if canceled before application. */
  applied: Deferred<void>
  optimisticSnapshot?: {
    upserts: Map<TKey, T>
    deletes: Set<TKey>
    ownership: Map<
      TKey,
      Array<
        | { type: `upsert`; value: T; transaction?: Transaction<any> }
        | { type: `delete`; transaction?: Transaction<any> }
      >
    >
  }
  preserveHydrationSeedKeys?: boolean
  /** Present on adapter transactions that can be revalidated after cancel. */
  duplicateKeyError?: (key: TKey) => DuplicateKeySyncError
  /** Retained until commit so an invalidated active transaction stays addressable. */
  invalidationError?: Error
  /**
   * When true, this transaction should be processed immediately even if there
   * are persisting user transactions. Used by manual write operations (writeInsert,
   * writeUpdate, writeDelete, writeUpsert) which need synchronous updates to syncedData.
   */
  immediate?: boolean
}

type PendingMetadataWrite = { type: `set`; value: unknown } | { type: `delete` }

/** The row metadata a sync operation writes unless the adapter set it explicitly. */
export function automaticRowMetadataWrite(
  operation: Pick<OptimisticChangeMessage<object>, `type` | `metadata`>,
): PendingMetadataWrite | undefined {
  if (operation.metadata !== undefined && operation.type !== `delete`) {
    return { type: `set`, value: operation.metadata }
  }
  return operation.type === `update` ? undefined : { type: `delete` }
}

type InsertDependency = { mutation: object; transaction: Transaction<any> }

type OptimisticUpsert<T extends object> = Pick<
  PendingMutation<T>,
  `key` | `modified`
> & { insertDependency?: InsertDependency }

type InternalChangeMessage<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> = ChangeMessage<T, TKey> & {
  __virtualProps?: {
    value?: VirtualRowProps<TKey>
    previousValue?: VirtualRowProps<TKey>
  }
}
export class CollectionStateManager<
  TOutput extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInput extends object = TOutput,
> {
  public config!: CollectionConfig<TOutput, TKey, TSchema, any>
  public collection!: CollectionImpl<TOutput, TKey, any, TSchema, TInput>
  public lifecycle!: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
  public changes!: CollectionChangesManager<TOutput, TKey, TSchema, TInput>
  public indexes!: CollectionIndexesManager<TOutput, TKey, TSchema, TInput>
  private _events!: CollectionEventsManager

  // Core state - make public for testing
  public transactions: SortedMap<string, Transaction<any>>
  public pendingSyncedTransactions: Array<
    PendingSyncedTransaction<TOutput, TKey>
  > = []
  private pendingSyncedProjection: PendingSyncedProjection<TOutput, TKey> = {
    states: new Map(),
    truncated: false,
  }
  public syncedData: SortedMap<TKey, TOutput>
  public syncedMetadata = new Map<TKey, unknown>()
  public syncedCollectionMetadata = new Map<string, unknown>()
  public hydrationSeedKeys = new Set<TKey>()
  public hydratedKeys = new Set<TKey>()
  // DbClient may receive a stale hydration chunk after an adapter delete.
  // Only DbClient collections retain these absences until cleanup because
  // hydration has no completion boundary.
  private appliedAdapterDeletedKeys?: Set<TKey>
  private hasAppliedAdapterTruncate = false

  // Optimistic state tracking - make public for testing
  public optimisticUpserts = new Map<TKey, TOutput>()
  public optimisticDeletes = new Set<TKey>()

  public pendingOptimisticUpserts = new Map<TKey, OptimisticUpsert<TOutput>>()
  public pendingOptimisticDeletes = new Set<TKey>()
  public pendingOptimisticDirectUpserts = new Set<TKey>()
  public pendingOptimisticDirectDeletes = new Set<TKey>()
  private acknowledgedInserts = new WeakSet<object>()

  /**
   * Tracks the origin of confirmed changes for each row.
   * 'local' = change originated from this client
   * 'remote' = change was received via sync
   *
   * This is used for the $origin virtual property.
   * Note: This only tracks *confirmed* changes, not optimistic ones.
   * Optimistic changes are always considered 'local' for $origin.
   */
  public rowOrigins = new Map<TKey, VirtualOrigin>()

  /**
   * Tracks keys that have pending local changes.
   * Used to determine whether sync-confirmed data should have 'local' or 'remote' origin.
   * When sync confirms data for a key with pending local changes, it keeps 'local' origin.
   */
  public pendingLocalChanges = new Set<TKey>()
  // Successful mutations retain attribution until sync applies. Active or
  // failed mutations must not add to, or erase a sibling's entry in, this set.
  public pendingLocalOrigins = new Set<TKey>()

  private virtualPropsCache = new WeakMap<
    object,
    {
      synced: boolean
      origin: VirtualOrigin
      key: TKey
      collectionId: string
      enriched: WithVirtualProps<TOutput, TKey>
    }
  >()

  // Cached size for performance
  public size = 0

  // State used for computing the change events
  // Hidden keys are captured as undefined so a later recompute cannot become
  // the baseline for a sync commit that must publish that key's change.
  public preSyncVisibleState = new Map<TKey, TOutput | undefined>()
  public preSyncVirtualState = new Map<TKey, VirtualRowProps<TKey>>()
  public recentlySyncedKeys = new Set<TKey>()
  public hasReceivedFirstCommit = false
  public isCommittingSyncTransactions = false
  private isDrainingSyncTransactions = false
  private syncRunGeneration = 0
  public isLocalOnly = false

  /**
   * Creates a new CollectionState manager
   */
  constructor(config: CollectionConfig<TOutput, TKey, TSchema, any>) {
    this.config = config
    this.transactions = new SortedMap<string, Transaction<any>>((a, b) =>
      a.compareCreatedAt(b),
    )

    // Set up data storage - always use SortedMap for deterministic iteration.
    // If a custom compare function is provided, use it; otherwise entries are sorted by key only.
    this.syncedData = new SortedMap<TKey, TOutput>(config.compare)
  }

  setDeps(deps: {
    collection: CollectionImpl<TOutput, TKey, any, TSchema, TInput>
    lifecycle: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
    changes: CollectionChangesManager<TOutput, TKey, TSchema, TInput>
    indexes: CollectionIndexesManager<TOutput, TKey, TSchema, TInput>
    events: CollectionEventsManager
  }) {
    this.collection = deps.collection
    this.lifecycle = deps.lifecycle
    this.changes = deps.changes
    this.indexes = deps.indexes
    this._events = deps.events
  }

  /**
   * Checks whether this row currently has no pending local optimistic writes.
   *
   * This is local mutation status, not backend confirmation: `true` means the
   * row is not currently affected by an optimistic transaction in this
   * collection's visible state.
   *
   * Used to compute the $synced virtual property.
   */
  public isRowSynced(key: TKey): boolean {
    if (this.isLocalOnly) {
      return true
    }
    return !this.optimisticUpserts.has(key) && !this.optimisticDeletes.has(key)
  }

  /**
   * Gets the origin of the last confirmed change to a row.
   * Returns 'local' if the row has optimistic mutations (optimistic changes are local).
   * Used to compute the $origin virtual property.
   */
  public getRowOrigin(key: TKey): VirtualOrigin {
    if (this.isLocalOnly) {
      return 'local'
    }
    // If there are optimistic changes, they're local
    if (this.optimisticUpserts.has(key) || this.optimisticDeletes.has(key)) {
      return 'local'
    }
    // Otherwise, return the confirmed origin (defaults to 'remote' for synced data)
    return this.rowOrigins.get(key) ?? 'remote'
  }

  private createVirtualPropsSnapshot(
    key: TKey,
    overrides?: Partial<VirtualRowProps<TKey>>,
  ): VirtualRowProps<TKey> {
    const synced = overrides?.$synced ?? this.isRowSynced(key)
    return {
      $hasPendingWrites: !synced,
      $synced: synced,
      $origin: overrides?.$origin ?? this.getRowOrigin(key),
      $key: overrides?.$key ?? key,
      $collectionId: overrides?.$collectionId ?? this.collection.id,
    }
  }

  private getVirtualPropsSnapshotForState(
    key: TKey,
    options?: {
      rowOrigins?: ReadonlyMap<TKey, VirtualOrigin>
      optimisticUpserts?: Pick<Map<TKey, unknown>, 'has'>
      optimisticDeletes?: Pick<Set<TKey>, 'has'>
      completedOptimisticKeys?: Pick<Set<TKey>, 'has'>
    },
  ): VirtualRowProps<TKey> {
    if (this.isLocalOnly) {
      return this.createVirtualPropsSnapshot(key, {
        $synced: true,
        $origin: 'local',
      })
    }

    const optimisticUpserts =
      options?.optimisticUpserts ?? this.optimisticUpserts
    const optimisticDeletes =
      options?.optimisticDeletes ?? this.optimisticDeletes
    const hasOptimisticChange =
      optimisticUpserts.has(key) ||
      optimisticDeletes.has(key) ||
      options?.completedOptimisticKeys?.has(key) === true

    return this.createVirtualPropsSnapshot(key, {
      $synced: !hasOptimisticChange,
      $origin: hasOptimisticChange
        ? 'local'
        : ((options?.rowOrigins ?? this.rowOrigins).get(key) ?? 'remote'),
    })
  }

  private snapshotRowOriginsForKeys(
    keys: Iterable<TKey>,
  ): Map<TKey, VirtualOrigin> {
    const rowOrigins = new Map<TKey, VirtualOrigin>()

    for (const key of keys) {
      const origin = this.rowOrigins.get(key)
      if (origin !== undefined) {
        rowOrigins.set(key, origin)
      }
    }

    return rowOrigins
  }

  private enrichWithVirtualPropsSnapshot(
    row: TOutput,
    virtualProps: VirtualRowProps<TKey>,
  ): WithVirtualProps<TOutput, TKey> {
    const existingRow = row as Partial<WithVirtualProps<TOutput, TKey>>
    const synced = existingRow.$synced ?? virtualProps.$synced
    const origin = existingRow.$origin ?? virtualProps.$origin
    const resolvedKey = existingRow.$key ?? virtualProps.$key
    const collectionId = existingRow.$collectionId ?? virtualProps.$collectionId

    const cached = this.virtualPropsCache.get(row as object)
    if (
      cached &&
      cached.synced === synced &&
      cached.origin === origin &&
      cached.key === resolvedKey &&
      cached.collectionId === collectionId
    ) {
      return cached.enriched
    }

    const enriched = {
      ...row,
      $hasPendingWrites: !synced,
      $synced: synced,
      $origin: origin,
      $key: resolvedKey,
      $collectionId: collectionId,
    } as WithVirtualProps<TOutput, TKey>

    this.virtualPropsCache.set(row as object, {
      synced,
      origin,
      key: resolvedKey,
      collectionId,
      enriched,
    })

    return enriched
  }

  private clearOriginTrackingState(): void {
    this.rowOrigins.clear()
    this.pendingLocalChanges.clear()
    this.pendingLocalOrigins.clear()
  }

  /**
   * Enriches a row with virtual properties using the "add-if-missing" pattern.
   * If the row already has virtual properties (from an upstream collection),
   * they are preserved. Otherwise, new values are computed.
   */
  public enrichWithVirtualProps(
    row: TOutput,
    key: TKey,
  ): WithVirtualProps<TOutput, TKey> {
    return this.enrichWithVirtualPropsSnapshot(
      row,
      this.createVirtualPropsSnapshot(key),
    )
  }

  /**
   * Creates a change message with virtual properties.
   * Uses the "add-if-missing" pattern so that pass-through from upstream
   * collections works correctly.
   */
  public enrichChangeMessage(
    change: ChangeMessage<TOutput, TKey>,
  ): ChangeMessage<WithVirtualProps<TOutput, TKey>, TKey> {
    const { __virtualProps } = change as InternalChangeMessage<TOutput, TKey>
    const enrichedValue = __virtualProps?.value
      ? this.enrichWithVirtualPropsSnapshot(change.value, __virtualProps.value)
      : this.enrichWithVirtualProps(change.value, change.key)
    const enrichedPreviousValue = change.previousValue
      ? __virtualProps?.previousValue
        ? this.enrichWithVirtualPropsSnapshot(
            change.previousValue,
            __virtualProps.previousValue,
          )
        : this.enrichWithVirtualProps(change.previousValue, change.key)
      : undefined

    return {
      key: change.key,
      type: change.type,
      value: enrichedValue,
      previousValue: enrichedPreviousValue,
      metadata: change.metadata,
    } as ChangeMessage<WithVirtualProps<TOutput, TKey>, TKey>
  }

  /**
   * Get the current value for a key enriched with virtual properties.
   */
  public getWithVirtualProps(
    key: TKey,
  ): WithVirtualProps<TOutput, TKey> | undefined {
    const value = this.get(key)
    if (value === undefined) {
      return undefined
    }
    return this.enrichWithVirtualProps(value, key)
  }

  /**
   * Get the current value for a key (virtual derived state)
   */
  public get(key: TKey): TOutput | undefined {
    const { optimisticDeletes, optimisticUpserts, syncedData } = this
    // Check if optimistically deleted
    if (optimisticDeletes.has(key)) {
      return undefined
    }

    // Check optimistic upserts first
    if (optimisticUpserts.has(key)) {
      return optimisticUpserts.get(key)
    }

    // Fall back to synced data
    return syncedData.get(key)
  }

  /**
   * Check if a key exists in the collection (virtual derived state)
   */
  public has(key: TKey): boolean {
    const { optimisticDeletes, optimisticUpserts, syncedData } = this
    // Check if optimistically deleted
    if (optimisticDeletes.has(key)) {
      return false
    }

    // Check optimistic upserts first
    if (optimisticUpserts.has(key)) {
      return true
    }

    // Fall back to synced data
    return syncedData.has(key)
  }

  /**
   * Get all keys (virtual derived state)
   */
  public *keys(): IterableIterator<TKey> {
    const { syncedData, optimisticDeletes, optimisticUpserts } = this
    // Yield keys from synced data, skipping any that are deleted.
    for (const key of syncedData.keys()) {
      if (!optimisticDeletes.has(key)) {
        yield key
      }
    }
    // Yield keys from upserts that were not already in synced data.
    for (const key of optimisticUpserts.keys()) {
      if (!syncedData.has(key) && !optimisticDeletes.has(key)) {
        // The optimisticDeletes check is technically redundant if inserts/updates always remove from deletes,
        // but it's safer to keep it.
        yield key
      }
    }
  }

  /**
   * Get all values (virtual derived state)
   */
  public *values(): IterableIterator<TOutput> {
    for (const key of this.keys()) {
      const value = this.get(key)
      if (value !== undefined) {
        yield value
      }
    }
  }

  /**
   * Get all entries (virtual derived state)
   */
  public *entries(): IterableIterator<[TKey, TOutput]> {
    for (const key of this.keys()) {
      const value = this.get(key)
      if (value !== undefined) {
        yield [key, value]
      }
    }
  }

  /**
   * Visible entries whose stored row passes `prefilter`, enriched with virtual
   * properties. Rows that fail are never copied.
   */
  public *entriesPassing(
    prefilter: (row: object) => boolean,
  ): IterableIterator<[TKey, WithVirtualProps<TOutput, TKey>]> {
    // Without optimistic state, the visible rows are the synced rows in order.
    const rows =
      this.optimisticUpserts.size === 0 && this.optimisticDeletes.size === 0
        ? this.syncedData
        : this.entries()
    for (const [key, row] of rows) {
      if (prefilter(row)) yield [key, this.enrichWithVirtualProps(row, key)]
    }
  }

  /**
   * Get all entries (virtual derived state)
   */
  public *[Symbol.iterator](): IterableIterator<[TKey, TOutput]> {
    for (const [key, value] of this.entries()) {
      yield [key, value]
    }
  }

  /**
   * Execute a callback for each entry in the collection
   */
  public forEach(
    callbackfn: (value: TOutput, key: TKey, index: number) => void,
  ): void {
    let index = 0
    for (const [key, value] of this.entries()) {
      callbackfn(value, key, index++)
    }
  }

  /**
   * Create a new array with the results of calling a function for each entry in the collection
   */
  public map<U>(
    callbackfn: (value: TOutput, key: TKey, index: number) => U,
  ): Array<U> {
    const result: Array<U> = []
    let index = 0
    for (const [key, value] of this.entries()) {
      result.push(callbackfn(value, key, index++))
    }
    return result
  }

  /**
   * Check if the given collection is this collection
   * @param collection The collection to check
   * @returns True if the given collection is this collection, false otherwise
   */
  private isThisCollection(
    collection: CollectionImpl<any, any, any, any, any>,
  ): boolean {
    return collection === this.collection
  }

  /**
   * Recompute optimistic state from active transactions
   */
  public recomputeOptimisticState(
    triggeredByUserAction: boolean = false,
  ): void {
    // Skip redundant recalculations when we're in the middle of committing sync transactions
    // While the sync pipeline is replaying a large batch we still want to honour
    // fresh optimistic mutations from the UI. Only skip recompute for the
    // internal sync-driven redraws; user-triggered work (triggeredByUserAction)
    // must run so live queries stay responsive during long commits.
    if (this.isCommittingSyncTransactions && !triggeredByUserAction) {
      return
    }

    const previousState = new Map(this.optimisticUpserts)
    const previousDeletes = new Set(this.optimisticDeletes)
    const previousRowOrigins = this.rowOrigins

    // A retained update can depend on an unconfirmed insert, not just its key.
    // Keep that exact dependency so settlement and key reuse cannot conflate rows.
    const pendingInserts = new Map<TKey, InsertDependency>()
    // Retain successful contributions; failed/active work is recomputed below.
    for (const transaction of this.transactions.values()) {
      const isDirectTransaction =
        transaction.metadata[DIRECT_TRANSACTION_METADATA_KEY] === true
      if (transaction.state === `completed`) {
        for (const mutation of transaction.mutations) {
          if (!this.isThisCollection(mutation.collection)) {
            continue
          }
          // Only a sync write during this insertion acknowledges it. A stale
          // base row can also exist after an optimistic delete and reinsert.
          if (
            isDirectTransaction &&
            mutation.type === `insert` &&
            this.acknowledgedInserts.has(mutation)
          ) {
            continue
          }
          this.pendingLocalOrigins.add(mutation.key)
          if (!mutation.optimistic) {
            continue
          }
          switch (mutation.type) {
            case `insert`:
            case `update`: {
              // Retain whole snapshots, not fields rebased over newer synced
              // values. A slow insert must not replace its accepted dependent
              // update with the older insertion snapshot.
              const previous = this.pendingOptimisticUpserts.get(mutation.key)
              const confirmsInsert =
                previous?.insertDependency?.mutation === mutation
              const insertDependency =
                mutation.type === `update`
                  ? (previous?.insertDependency ??
                    pendingInserts.get(mutation.key))
                  : undefined
              this.pendingOptimisticUpserts.set(mutation.key, {
                key: mutation.key,
                modified: confirmsInsert
                  ? previous.modified
                  : mutation.modified,
                insertDependency,
              })
              // This accepted edit is conditional on the unconfirmed insert.
              // It cannot retire the accepted delete underneath that insert.
              if (!insertDependency) {
                this.pendingOptimisticDeletes.delete(mutation.key)
                this.pendingOptimisticDirectDeletes.delete(mutation.key)
              }
              if (isDirectTransaction) {
                this.pendingOptimisticDirectUpserts.add(mutation.key)
              } else {
                this.pendingOptimisticDirectUpserts.delete(mutation.key)
              }
              break
            }
            case `delete`: {
              // An accepted edit of a still-active reinsert belongs after this
              // older delete. Keep both layers so failure of the insert still
              // reveals the accepted delete.
              const hasDependentEdit =
                this.pendingOptimisticUpserts.get(mutation.key)
                  ?.insertDependency !== undefined
              if (!hasDependentEdit) {
                this.pendingOptimisticUpserts.delete(mutation.key)
                this.pendingOptimisticDirectUpserts.delete(mutation.key)
              }
              this.pendingOptimisticDeletes.add(mutation.key)
              if (isDirectTransaction) {
                this.pendingOptimisticDirectDeletes.add(mutation.key)
              } else {
                this.pendingOptimisticDirectDeletes.delete(mutation.key)
              }
              break
            }
          }
        }
      } else {
        for (const mutation of transaction.mutations) {
          if (
            !this.isThisCollection(mutation.collection) ||
            mutation.type !== `insert` ||
            !mutation.optimistic
          )
            continue
          if (
            transaction.state !== `failed` &&
            !this.acknowledgedInserts.has(mutation)
          ) {
            pendingInserts.set(mutation.key, { mutation, transaction })
          } else if (
            this.pendingOptimisticUpserts.get(mutation.key)?.insertDependency
              ?.mutation === mutation
          ) {
            // Drop only the dependent row, never a later same-key insertion or
            // successful sibling attribution. Failed transactions remain listed.
            this.pendingOptimisticUpserts.delete(mutation.key)
            this.pendingOptimisticDirectUpserts.delete(mutation.key)
          }
        }
      }
    }

    // Clear current optimistic state
    this.optimisticUpserts.clear()
    this.optimisticDeletes.clear()
    this.pendingLocalChanges.clear()

    // Seed optimistic state with pending optimistic mutations only when a sync is pending
    const pendingSyncKeys = new Set<TKey>()
    for (const transaction of this.pendingSyncedTransactions) {
      for (const operation of transaction.operations) {
        pendingSyncKeys.add(operation.key as TKey)
      }
    }
    const staleOptimisticUpserts: Array<TKey> = []
    for (const [key, value] of this.pendingOptimisticUpserts) {
      if (
        pendingSyncKeys.has(key) ||
        this.pendingOptimisticDirectUpserts.has(key)
      ) {
        this.optimisticUpserts.set(key, this.resolveOptimisticUpsert(value))
      } else {
        staleOptimisticUpserts.push(key)
      }
    }
    for (const key of staleOptimisticUpserts) {
      this.pendingOptimisticUpserts.delete(key)
      this.pendingLocalOrigins.delete(key)
    }
    const staleOptimisticDeletes: Array<TKey> = []
    for (const key of this.pendingOptimisticDeletes) {
      if (
        pendingSyncKeys.has(key) ||
        this.pendingOptimisticDirectDeletes.has(key)
      ) {
        this.optimisticDeletes.add(key)
      } else {
        staleOptimisticDeletes.push(key)
      }
    }
    for (const key of staleOptimisticDeletes) {
      this.pendingOptimisticDeletes.delete(key)
      this.pendingLocalOrigins.delete(key)
    }

    // Apply active transactions only (completed transactions are handled by sync operations)
    this.overlayActiveTransactions()

    // Update cached size
    this.size = this.calculateSize()

    // Collect events for changes
    const events: Array<InternalChangeMessage<TOutput, TKey>> = []
    this.collectOptimisticChanges(
      previousState,
      previousDeletes,
      previousRowOrigins,
      events,
    )

    // User-triggered work always publishes. Sync-driven redraws skip keys a
    // sync commit just published. Recompute keeps the optimistic layer of a
    // key with a pending sync operation, so it never emits a delete that the
    // sync would restore.
    const filteredEvents = triggeredByUserAction
      ? events
      : events.filter((event) => !this.recentlySyncedKeys.has(event.key))
    if (filteredEvents.length > 0) {
      this.indexes.updateIndexes(filteredEvents)
    }
    this.changes.emitEvents(filteredEvents, triggeredByUserAction)
  }

  /**
   * Overlay still-active optimistic mutations on the current layers and
   * record their keys as pending local changes for $origin tracking.
   * An active insert whose key the source just wrote is acknowledged.
   */
  private overlayActiveTransactions(
    sourceWrittenKeys?: ReadonlySet<TKey>,
  ): void {
    for (const transaction of this.transactions.values()) {
      if (transaction.state === `completed` || transaction.state === `failed`)
        continue
      for (const mutation of transaction.mutations) {
        if (!this.isThisCollection(mutation.collection)) continue
        this.pendingLocalChanges.add(mutation.key)
        if (
          mutation.type === `insert` &&
          sourceWrittenKeys?.has(mutation.key)
        ) {
          this.acknowledgedInserts.add(mutation)
        }
        if (!mutation.optimistic) continue
        if (mutation.type === `delete`) {
          this.optimisticUpserts.delete(mutation.key)
          this.optimisticDeletes.add(mutation.key)
        } else {
          this.optimisticUpserts.set(
            mutation.key,
            this.resolveOptimisticUpsert(mutation),
          )
          this.optimisticDeletes.delete(mutation.key)
        }
      }
    }
  }

  /**
   * Calculate the current size based on synced data and optimistic changes
   */
  private calculateSize(): number {
    const syncedSize = this.syncedData.size
    const deletesFromSynced = Array.from(this.optimisticDeletes).filter(
      (key) => this.syncedData.has(key) && !this.optimisticUpserts.has(key),
    ).length
    const upsertsNotInSynced = Array.from(this.optimisticUpserts.keys()).filter(
      (key) => !this.syncedData.has(key),
    ).length

    return syncedSize - deletesFromSynced + upsertsNotInSynced
  }

  /**
   * Collect events for optimistic changes
   */
  private collectOptimisticChanges(
    previousUpserts: Map<TKey, TOutput>,
    previousDeletes: Set<TKey>,
    previousRowOrigins: ReadonlyMap<TKey, VirtualOrigin>,
    events: Array<InternalChangeMessage<TOutput, TKey>>,
  ): void {
    const allKeys = new Set([
      ...previousUpserts.keys(),
      ...this.optimisticUpserts.keys(),
      ...previousDeletes,
      ...this.optimisticDeletes,
    ])

    for (const key of allKeys) {
      const currentValue = this.get(key)
      const previousValue = this.getPreviousValue(
        key,
        previousUpserts,
        previousDeletes,
      )
      const previousVirtualProps = this.getVirtualPropsSnapshotForState(key, {
        rowOrigins: previousRowOrigins,
        optimisticUpserts: previousUpserts,
        optimisticDeletes: previousDeletes,
      })
      const nextVirtualProps = this.getVirtualPropsSnapshotForState(key)

      if (previousValue !== undefined && currentValue === undefined) {
        events.push({
          type: `delete`,
          key,
          value: previousValue,
          __virtualProps: {
            value: previousVirtualProps,
          },
        })
      } else if (previousValue === undefined && currentValue !== undefined) {
        events.push({
          type: `insert`,
          key,
          value: currentValue,
          __virtualProps: {
            value: nextVirtualProps,
          },
        })
      } else if (
        previousValue !== undefined &&
        currentValue !== undefined &&
        (!deepEquals(previousValue, currentValue) ||
          previousVirtualProps.$origin !== nextVirtualProps.$origin ||
          previousVirtualProps.$synced !== nextVirtualProps.$synced)
      ) {
        events.push({
          type: `update`,
          key,
          value: currentValue,
          previousValue,
          __virtualProps: {
            value: nextVirtualProps,
            previousValue: previousVirtualProps,
          },
        })
      }
    }
  }

  // Optimistic mutations keep their full validated snapshot. Mixing in newer
  // synced fields could produce a row neither the user nor the server created.
  private resolveOptimisticUpsert(
    mutation: OptimisticUpsert<TOutput>,
  ): TOutput {
    const key = mutation.key as TKey
    const dependent = this.pendingOptimisticUpserts.get(key)
    return dependent?.insertDependency?.mutation === mutation
      ? dependent.modified
      : mutation.modified
  }

  /**
   * Capture the optimistic layers that exist when a truncate is authored.
   * Keeping their exact owners lets application discard a later rollback
   * without reviving a failed same-key winner or retaining post-capture work.
   */
  public captureTruncateOptimisticSnapshot(): NonNullable<
    PendingSyncedTransaction<TOutput, TKey>[`optimisticSnapshot`]
  > {
    const upserts = new Map(this.optimisticUpserts)
    const deletes = new Set(this.optimisticDeletes)
    const ownership = new Map<
      TKey,
      Array<
        | {
            type: `upsert`
            value: TOutput
            transaction?: Transaction<any>
          }
        | { type: `delete`; transaction?: Transaction<any> }
      >
    >()
    const capturedKeys = new Set([...upserts.keys(), ...deletes])
    const addLayer = (
      key: TKey,
      layer:
        | {
            type: `upsert`
            value: TOutput
            transaction?: Transaction<any>
          }
        | { type: `delete`; transaction?: Transaction<any> },
    ) => {
      if (!capturedKeys.has(key)) return
      const layers = ownership.get(key) ?? []
      layers.push(layer)
      ownership.set(key, layers)
    }

    for (const key of capturedKeys) {
      const acceptedUpsert = this.pendingOptimisticUpserts.get(key)
      // A later accepted edit can depend on an active insert above an older
      // accepted delete. Capture both so the delete survives insert rollback.
      if (this.pendingOptimisticDeletes.has(key)) {
        addLayer(key, { type: `delete` })
      }
      if (acceptedUpsert) {
        addLayer(key, {
          type: `upsert`,
          value: this.resolveOptimisticUpsert(acceptedUpsert),
          transaction: acceptedUpsert.insertDependency?.transaction,
        })
      }
    }

    for (const transaction of this.transactions.values()) {
      if ([`completed`, `failed`].includes(transaction.state)) continue
      for (const mutation of transaction.mutations) {
        if (
          !mutation.optimistic ||
          !this.isThisCollection(mutation.collection) ||
          !capturedKeys.has(mutation.key as TKey)
        )
          continue
        if (mutation.type === `delete`) {
          addLayer(mutation.key as TKey, { type: `delete`, transaction })
        } else {
          addLayer(mutation.key as TKey, {
            type: `upsert`,
            value: this.resolveOptimisticUpsert(mutation),
            transaction,
          })
        }
      }
    }

    return { upserts, deletes, ownership }
  }

  /** Build once per output flush; queued membership excludes optimistic edits. */
  createSyncedKeyLookup(): (key: TKey) => boolean {
    if (this.pendingSyncedTransactions.length === 0)
      return (key) => this.syncedData.has(key)
    const queued = new Map<TKey, boolean>()
    let truncated = false
    for (const transaction of this.pendingSyncedTransactions) {
      if (!transaction.committed) continue
      if (transaction.truncate) {
        queued.clear()
        truncated = true
      }
      for (const operation of transaction.operations) {
        queued.set(operation.key as TKey, operation.type !== `delete`)
      }
    }
    return (key) => queued.get(key) ?? (!truncated && this.syncedData.has(key))
  }

  enableHydrationAuthorityTracking(): void {
    this.appliedAdapterDeletedKeys ??= new Set<TKey>()
  }

  /** A late hydration seed cannot supersede committed adapter work. */
  createAdapterAuthorityLookup(): (key: TKey) => boolean {
    const queuedKeys = new Set<TKey>()
    let queuedTruncate = false
    for (const transaction of this.pendingSyncedTransactions) {
      if (!transaction.committed || transaction.preserveHydrationSeedKeys)
        continue
      if (transaction.truncate) queuedTruncate = true
      for (const operation of transaction.operations) {
        queuedKeys.add(operation.key as TKey)
      }
    }
    return (key) =>
      this.hasAppliedAdapterTruncate ||
      queuedTruncate ||
      queuedKeys.has(key) ||
      this.appliedAdapterDeletedKeys?.has(key) === true ||
      (this.syncedData.has(key) && !this.hydrationSeedKeys.has(key))
  }

  private getProjectedSyncedKeyState(
    projection: PendingSyncedProjection<TOutput, TKey>,
    key: TKey,
  ): PendingSyncedKeyState<TOutput> {
    const state = projection.states.get(key)
    if (state !== undefined) return state
    if (projection.truncated) return { exists: false, value: undefined }
    return {
      exists: this.syncedData.has(key),
      value: this.syncedData.get(key),
    }
  }

  private classifyProjectedInsert(
    projection: PendingSyncedProjection<TOutput, TKey>,
    key: TKey,
    value: TOutput,
  ): PendingInsertDisposition {
    const current = this.getProjectedSyncedKeyState(projection, key)
    if (!current.exists) return `insert`
    if (
      (current.value !== undefined && deepEquals(current.value, value)) ||
      this.hydrationSeedKeys.has(key)
    ) {
      return `update`
    }
    return `duplicate`
  }

  /** Classify an adapter insert against retained and queued source state. */
  classifyPendingSyncedInsert(
    key: TKey,
    value: TOutput,
  ): PendingInsertDisposition {
    return this.classifyProjectedInsert(
      this.pendingSyncedProjection,
      key,
      value,
    )
  }

  private applyPendingSyncOperation(
    projection: PendingSyncedProjection<TOutput, TKey>,
    operation: PendingSyncOperation<TOutput, TKey>,
  ): void {
    const key = operation.key as TKey
    const rowUpdateMode = this.config.sync.rowUpdateMode || `partial`
    if (operation.type === `delete`) {
      projection.states.set(key, { exists: false, value: undefined })
    } else if (operation.type === `update` && rowUpdateMode === `partial`) {
      const current = this.getProjectedSyncedKeyState(projection, key)
      projection.states.set(key, {
        exists: true,
        value: Object.assign({}, current.value, operation.value),
      })
    } else {
      projection.states.set(key, { exists: true, value: operation.value })
    }
  }

  /** Extend the queued projection after admitting one sync operation. */
  stagePendingSyncOperation(
    operation: PendingSyncOperation<TOutput, TKey>,
  ): void {
    if (
      operation.type === `update` &&
      operation.originalSyncType !== `insert` &&
      this.config.sync.rowUpdateMode !== `full`
    ) {
      operation.admittedAgainstExistingRow = this.getProjectedSyncedKeyState(
        this.pendingSyncedProjection,
        operation.key as TKey,
      ).exists
    }
    this.applyPendingSyncOperation(this.pendingSyncedProjection, operation)
  }

  /**
   * Get the previous value for a key given previous optimistic state
   */
  private getPreviousValue(
    key: TKey,
    previousUpserts: Map<TKey, TOutput>,
    previousDeletes: Set<TKey>,
  ): TOutput | undefined {
    if (previousDeletes.has(key)) {
      return undefined
    }
    if (previousUpserts.has(key)) {
      return previousUpserts.get(key)
    }
    return this.syncedData.get(key)
  }

  private rebuildAutomaticRowMetadataWrites(
    transaction: PendingSyncedTransaction<TOutput, TKey>,
  ): void {
    const explicitKeys = transaction.explicitRowMetadataWriteKeys ?? new Set()
    const operationKeys = new Set(
      transaction.operations.map((operation) => operation.key as TKey),
    )
    for (const key of operationKeys) {
      if (!explicitKeys.has(key)) transaction.rowMetadataWrites.delete(key)
    }
    for (const operation of transaction.operations) {
      const key = operation.key as TKey
      const metadataWrite = automaticRowMetadataWrite(operation)
      if (!explicitKeys.has(key) && metadataWrite) {
        transaction.rowMetadataWrites.set(key, metadataWrite)
      }
    }
  }

  private rebuildPendingSyncedProjection(): Array<{
    transaction: PendingSyncedTransaction<TOutput, TKey>
    key: TKey
    error: Error
  }> {
    const projection: PendingSyncedProjection<TOutput, TKey> = {
      states: new Map(),
      truncated: false,
    }
    const invalidCommitted: Array<{
      transaction: PendingSyncedTransaction<TOutput, TKey>
      key: TKey
      error: Error
    }> = []

    for (const transaction of this.pendingSyncedTransactions) {
      // An open transaction invalidated by cancellation remains doomed until
      // its commit returns the rejected applied receipt. truncate() can reset
      // it explicitly after clearing its operations.
      if (transaction.invalidationError !== undefined) continue
      const wasTruncated = projection.truncated
      const statesBeforeTruncate = transaction.truncate
        ? projection.states
        : undefined
      const previousStates = new Map<
        TKey,
        PendingSyncedKeyState<TOutput> | undefined
      >()
      if (transaction.truncate) {
        projection.states = new Map()
        projection.truncated = true
      }

      let invalidKey: TKey | undefined
      let invalidReason: Error | undefined
      for (const operation of transaction.operations) {
        const key = operation.key as TKey
        if (!previousStates.has(key)) {
          previousStates.set(key, projection.states.get(key))
        }
        if (
          operation.originalSyncType === `insert` &&
          operation.type !== `delete`
        ) {
          const disposition = this.classifyProjectedInsert(
            projection,
            key,
            operation.value,
          )
          if (disposition === `duplicate`) {
            invalidKey = key
            break
          }
          operation.type = disposition
        }
        if (
          operation.admittedAgainstExistingRow === true &&
          !this.getProjectedSyncedKeyState(projection, key).exists
        ) {
          // Cancellation must not turn an admitted dependent update into an
          // independent missing-key upsert during queue replay.
          invalidKey = key
          invalidReason = new SyncTransactionAbortedError()
          break
        }
        this.applyPendingSyncOperation(projection, operation)
      }

      if (invalidKey !== undefined) {
        if (statesBeforeTruncate !== undefined) {
          projection.states = statesBeforeTruncate
        } else {
          for (const [key, previous] of previousStates) {
            if (previous === undefined) projection.states.delete(key)
            else projection.states.set(key, previous)
          }
        }
        projection.truncated = wasTruncated
        const error =
          invalidReason ??
          transaction.duplicateKeyError?.(invalidKey) ??
          new SyncTransactionAbortedError()
        if (transaction.committed) {
          invalidCommitted.push({ transaction, key: invalidKey, error })
          continue
        }
        transaction.invalidationError = error
        continue
      }
      this.rebuildAutomaticRowMetadataWrites(transaction)
    }

    this.pendingSyncedProjection = projection
    return invalidCommitted
  }

  private rejectInvalidCommittedTransactions(
    invalid: ReturnType<typeof this.rebuildPendingSyncedProjection>,
  ): Set<TKey> {
    const rejected = new Set(invalid.map(({ transaction }) => transaction))
    this.pendingSyncedTransactions = this.pendingSyncedTransactions.filter(
      (transaction) => !rejected.has(transaction),
    )
    const canceledKeys = new Set<TKey>()
    for (const { transaction, error } of invalid) {
      for (const operation of transaction.operations) {
        canceledKeys.add(operation.key as TKey)
      }
      transaction.applied.reject(error)
    }
    return canceledKeys
  }

  /** Rebuild after truncate or application changes queue history. */
  refreshPendingSyncedProjection(): void {
    const invalid = this.rebuildPendingSyncedProjection()
    if (invalid.length === 0) return
    this.rejectInvalidCommittedTransactions(invalid)
    throw invalid[0]!.error
  }

  /**
   * Attempts to commit pending synced transactions if there are no active transactions
   * This method processes operations from pending transactions and applies them to the synced data
   */
  commitPendingTransactions = () => {
    if (this.isDrainingSyncTransactions) return
    this.isDrainingSyncTransactions = true
    let failed = false
    let firstError: unknown
    try {
      let result: { processed: boolean; failure?: { error: unknown } }
      do {
        result = this.commitNextPendingTransactionBatch()
        if (result.failure && !failed) {
          failed = true
          firstError = result.failure.error
        }
      } while (result.processed)
    } finally {
      this.isDrainingSyncTransactions = false
    }
    if (failed) throw firstError
  }

  private commitNextPendingTransactionBatch(): {
    processed: boolean
    failure?: { error: unknown }
  } {
    const syncRunGeneration = this.syncRunGeneration
    // Check if there are any persisting transaction
    let hasPersistingTransaction = false
    for (const transaction of this.transactions.values()) {
      if (transaction.state === `persisting`) {
        hasPersistingTransaction = true
        break
      }
    }

    // pending synced transactions could be either `committed` or still open.
    // we only want to process `committed` transactions here
    const committedSyncedTransactions: Array<
      PendingSyncedTransaction<TOutput, TKey>
    > = []
    const uncommittedSyncedTransactions: Array<
      PendingSyncedTransaction<TOutput, TKey>
    > = []
    let hasTruncateSync = false
    let hasImmediateSync = false
    let layoutChanged = false
    for (const t of this.pendingSyncedTransactions) {
      if (t.committed) {
        committedSyncedTransactions.push(t)
        layoutChanged ||= t.layoutChanged
        hasTruncateSync ||= t.truncate === true
        hasImmediateSync ||= t.immediate === true
      } else {
        uncommittedSyncedTransactions.push(t)
      }
    }

    if (committedSyncedTransactions.length === 0) {
      return { processed: false }
    }

    // Process committed transactions if:
    // 1. No persisting user transaction (normal sync flow), OR
    // 2. There's a truncate operation (must be processed immediately), OR
    // 3. There's an immediate transaction (manual writes must be processed synchronously)
    //
    // Note: When hasImmediateSync or hasTruncateSync is true, we process ALL committed
    // sync transactions (not just the immediate/truncate ones). This is intentional for
    // ordering correctness: if we only processed the immediate transaction, earlier
    // non-immediate transactions would be applied later and could overwrite newer state.
    // Processing all committed transactions together preserves causal ordering.
    if (!hasPersistingTransaction || hasTruncateSync || hasImmediateSync) {
      const previousLayout = layoutChanged ? [...this.keys()] : undefined
      this.pendingSyncedTransactions = uncommittedSyncedTransactions

      // Application is now the point of no return. Event listeners run before
      // the receipts resolve, so a signal aborted from one of those listeners
      // must not cancel writes that are already becoming visible.
      const deferOrder =
        committedSyncedTransactions.reduce(
          (count, transaction) => count + transaction.operations.length,
          0,
        ) >= 512
      for (const transaction of committedSyncedTransactions) {
        transaction.applicationStarted = true
      }

      // Set flag to prevent redundant optimistic state recalculations
      this.isCommittingSyncTransactions = true

      // Get the optimistic snapshot from the truncate transaction (captured when truncate() was called)
      const truncateOptimisticSnapshot = hasTruncateSync
        ? committedSyncedTransactions.find((t) => t.truncate)
            ?.optimisticSnapshot
        : null
      // Snapshot capture and application can be separated by mutation
      // settlement. Freeze ownership at the application boundary: a rolled
      // back row is no longer owned, while an accepted non-direct mutation can
      // be cleared from the live pending maps by its source confirmation later
      // in this same atomic batch.
      const retainedTruncateLayer = (key: TKey) => {
        const layers = truncateOptimisticSnapshot?.ownership.get(key) ?? []
        for (let index = layers.length - 1; index >= 0; index--) {
          const layer = layers[index]!
          if (
            layer.transaction === undefined ||
            layer.transaction.state !== `failed`
          ) {
            return layer
          }
        }
        return undefined
      }
      let truncatePendingLocalChanges: Set<TKey> | undefined
      let truncatePendingLocalOrigins: Set<TKey> | undefined

      // First collect all keys that will be affected by sync operations
      const changedKeys = new Set<TKey>()
      const syncedInsertedOrUpdatedKeys = new Set<TKey>()
      const firstSyncOperations = new Map<
        TKey,
        OptimisticChangeMessage<TOutput>
      >()
      for (const transaction of committedSyncedTransactions) {
        for (const operation of transaction.operations) {
          const key = operation.key as TKey
          changedKeys.add(key)
          if (!firstSyncOperations.has(key))
            firstSyncOperations.set(key, operation)
          if (operation.type !== `delete`) syncedInsertedOrUpdatedKeys.add(key)
        }
        for (const [key] of transaction.rowMetadataWrites) {
          changedKeys.add(key)
        }
      }

      const virtualSnapshotKeys = new Set(changedKeys)
      for (const key of this.pendingOptimisticDirectUpserts) {
        virtualSnapshotKeys.add(key)
      }
      for (const key of this.pendingOptimisticDirectDeletes) {
        virtualSnapshotKeys.add(key)
      }
      const previousRowOrigins =
        this.snapshotRowOriginsForKeys(virtualSnapshotKeys)
      const previousOptimisticUpserts = new Map(this.optimisticUpserts)
      const previousOptimisticDeletes = new Set(this.optimisticDeletes)
      const completedDirectUpserts = new Set(
        this.pendingOptimisticDirectUpserts,
      )
      const completedDirectDeletes = new Set(
        this.pendingOptimisticDirectDeletes,
      )

      // Use pre-captured state if available (from optimistic scenarios),
      // otherwise capture current state (for pure sync scenarios)
      let currentVisibleState = this.preSyncVisibleState
      if (currentVisibleState.size === 0) {
        // No pre-captured state, capture it now for pure sync operations
        currentVisibleState = new Map<TKey, TOutput | undefined>()
        for (const key of changedKeys) {
          const currentValue = this.get(key)
          if (currentValue !== undefined) {
            currentVisibleState.set(key, currentValue)
          }
        }
      }

      const events: Array<ChangeMessage<TOutput, TKey>> = []
      if (hasTruncateSync) {
        // All queued transactions publish as one batch. Its clear prefix must
        // describe the prior visible rows, not intermediate queued writes.
        // Freeze metadata before replacement writes change row attribution.
        for (const [key, value] of this.entries()) {
          events.push({
            type: `delete`,
            key,
            value: this.enrichWithVirtualPropsSnapshot(
              value,
              this.getVirtualPropsSnapshotForState(key),
            ),
          })
        }
      }
      const rowUpdateMode = this.config.sync.rowUpdateMode || `partial`
      const completedOptimisticKeys = new Set<TKey>()
      for (const transaction of this.transactions.values()) {
        if (transaction.state !== `completed`) continue
        for (const mutation of transaction.mutations) {
          if (this.isThisCollection(mutation.collection) && mutation.optimistic)
            completedOptimisticKeys.add(mutation.key)
        }
      }

      for (const transaction of committedSyncedTransactions) {
        // Handle truncate operations first
        if (transaction.truncate) {
          // TRUNCATE PHASE
          // Clear the authoritative synced base. Subsequent server ops in this
          //    same commit will rebuild the base atomically.
          // Preserve pending local tracking just long enough for operations in this
          // truncate batch to retain correct local origin semantics.
          truncatePendingLocalChanges = new Set(this.pendingLocalChanges)
          truncatePendingLocalOrigins = new Set(this.pendingLocalOrigins)
          this.syncedData.clear()
          this.syncedMetadata.clear()
          this.hydrationSeedKeys.clear()
          this.hydratedKeys.clear()
          if (
            !transaction.preserveHydrationSeedKeys &&
            this.appliedAdapterDeletedKeys
          ) {
            this.hasAppliedAdapterTruncate = true
            this.appliedAdapterDeletedKeys.clear()
          }
          this.clearOriginTrackingState()

          // Clear currentVisibleState for truncated keys to ensure subsequent operations
          //    are compared against the post-truncate state (undefined) rather than pre-truncate state
          //    This ensures that re-inserted keys are emitted as INSERT events, not UPDATE events
          for (const key of changedKeys) {
            currentVisibleState.delete(key)
          }

          // Emit truncate event so subscriptions can reset their cursor tracking state
          this._events.emit(`truncate`, {
            type: `truncate`,
            collection: this.collection,
          })
        }

        // Attribution belongs to the whole atomic batch. A repeated write must
        // not forget the local acknowledgement consumed by its first operation.
        const localKeys = new Set<TKey>()
        for (const operation of transaction.operations) {
          const key = operation.key as TKey

          // Determine origin: 'local' for local-only collections or pending local changes
          const retainedLocalOrigin =
            truncatePendingLocalChanges?.has(key) === true ||
            (truncatePendingLocalOrigins?.has(key) === true &&
              !completedDirectUpserts.has(key) &&
              !completedDirectDeletes.has(key))
          const origin: VirtualOrigin =
            this.isLocalOnly ||
            this.pendingLocalChanges.has(key) ||
            this.pendingLocalOrigins.has(key) ||
            localKeys.has(key) ||
            retainedLocalOrigin
              ? 'local'
              : 'remote'
          if (origin === `local`) localKeys.add(key)

          if (operation.type === `delete`) {
            this.syncedData.delete(key, deferOrder)
            this.syncedMetadata.delete(key)
            this.rowOrigins.delete(key)
          } else {
            // A sync source may reuse a live-reading row object, making an
            // enriched snapshot cached for an earlier publication stale.
            this.virtualPropsCache.delete(operation.value)
            this.syncedData.set(
              key,
              operation.type === `update` && rowUpdateMode === `partial`
                ? Object.assign({}, this.syncedData.get(key), operation.value)
                : operation.value,
              deferOrder,
            )
            this.rowOrigins.set(key, origin)
          }
          // Source confirmation retires every pending local layer for the key.
          this.pendingLocalChanges.delete(key)
          this.pendingLocalOrigins.delete(key)
          this.pendingOptimisticUpserts.delete(key)
          this.pendingOptimisticDeletes.delete(key)
          this.pendingOptimisticDirectUpserts.delete(key)
          this.pendingOptimisticDirectDeletes.delete(key)
          if (!transaction.preserveHydrationSeedKeys) {
            this.hydrationSeedKeys.delete(key)
            this.hydratedKeys.delete(key)
            if (operation.type === `delete`)
              this.appliedAdapterDeletedKeys?.add(key)
            else this.appliedAdapterDeletedKeys?.delete(key)
          }
        }

        for (const [key, metadataWrite] of transaction.rowMetadataWrites) {
          if (metadataWrite.type === `delete`) {
            this.syncedMetadata.delete(key)
            continue
          }
          this.syncedMetadata.set(key, metadataWrite.value)
        }

        for (const [
          key,
          metadataWrite,
        ] of transaction.collectionMetadataWrites) {
          if (metadataWrite.type === `delete`) {
            this.syncedCollectionMetadata.delete(key)
            continue
          }
          this.syncedCollectionMetadata.set(key, metadataWrite.value)
        }
      }
      this.syncedData.restoreOrder()

      // The retained base now includes every removed committed transaction.
      // Rebuild only the projection for still-open transactions.
      this.refreshPendingSyncedProjection()

      // A completed optimistic insert may have used a temporary client key while
      // the sync confirmation used a different server-generated key. Once a
      // sync commit has been applied, stop retaining completed optimistic keys
      // that were not confirmed by this commit so the temporary row is removed.
      for (const key of this.pendingOptimisticDirectUpserts) {
        // An active delete can hide an accepted snapshot. Retain it through
        // truncate so rollback can restore it. A direct insert completed after
        // snapshot capture has no support in the replacement and must retire.
        if (
          hasTruncateSync &&
          this.pendingOptimisticUpserts.has(key) &&
          (truncateOptimisticSnapshot?.upserts.has(key) === true ||
            truncateOptimisticSnapshot?.deletes.has(key) === true) &&
          !changedKeys.has(key)
        )
          continue
        if (!changedKeys.has(key)) {
          changedKeys.add(key)
          // Truncate already emitted the prior visible rows as its clear
          // prefix. Reconstructing one here would publish a duplicate delete.
          if (!hasTruncateSync && !currentVisibleState.has(key)) {
            const previousValue = previousOptimisticUpserts.get(key)
            if (previousValue !== undefined) {
              currentVisibleState.set(key, previousValue)
            }
          }
          this.pendingOptimisticUpserts.delete(key)
          this.pendingLocalOrigins.delete(key)
        }
        this.pendingOptimisticDirectUpserts.delete(key)
      }
      for (const key of this.pendingOptimisticDirectDeletes) {
        if (
          hasTruncateSync &&
          (truncateOptimisticSnapshot?.deletes.has(key) ||
            truncateOptimisticSnapshot?.ownership
              .get(key)
              ?.some(
                (layer) => layer.type === `delete` && !layer.transaction,
              )) &&
          !changedKeys.has(key)
        )
          continue
        changedKeys.add(key)
        this.pendingOptimisticDeletes.delete(key)
        this.pendingLocalOrigins.delete(key)
        this.pendingOptimisticDirectDeletes.delete(key)
      }

      // Maintain optimistic state appropriately
      // Clear optimistic state since sync operations will now provide the authoritative data.
      // Any still-active user transactions will be re-applied below in recompute.
      this.optimisticUpserts.clear()
      this.optimisticDeletes.clear()

      // Reset flag and recompute optimistic state for any remaining active transactions
      this.isCommittingSyncTransactions = false

      // If we had a truncate, restore the preserved optimistic state from the snapshot
      // This includes items from transactions that may have completed during processing
      if (hasTruncateSync && truncateOptimisticSnapshot) {
        for (const key of truncateOptimisticSnapshot.ownership.keys()) {
          const layer = retainedTruncateLayer(key)
          if (!layer) continue
          if (layer.type === `upsert`) {
            if (completedDirectUpserts.has(key) && changedKeys.has(key))
              continue
            this.optimisticUpserts.set(key, layer.value)
          } else {
            if (completedDirectDeletes.has(key) && changedKeys.has(key))
              continue
            this.optimisticDeletes.add(key)
          }
        }
      }

      // Always overlay any still-active optimistic transactions so mutations that started
      // after the truncate snapshot are preserved. Truncate clears attribution
      // with the old base, not the still-live local requests.
      this.overlayActiveTransactions(syncedInsertedOrUpdatedKeys)

      // After applying synced operations, if this commit included a truncate,
      // re-apply optimistic mutations on top of the fresh synced base. This ensures
      // the UI preserves local intent while respecting server rebuild semantics.
      // Ordering: deletes (above) -> server ops (just applied) -> optimistic upserts.
      if (hasTruncateSync) {
        // Events use the same rebuilt overlay as synchronous reads. Until
        // this point the batch holds only the truncate delete prefix, so each
        // re-applied upsert publishes as an insert after it. A key is never
        // both an optimistic upsert and an optimistic delete.
        for (const [key, value] of this.optimisticUpserts) {
          events.push({ type: `insert`, key, value })
        }

        // Ensure listeners are active before emitting this critical batch
        if (this.lifecycle.status !== `ready`) {
          this.lifecycle.markReady()
        }
      }

      // Now check what actually changed in the final visible state
      for (const key of changedKeys) {
        const firstSyncOperation = firstSyncOperations.get(key)
        // A live-reading source can change a reused row before this commit
        // captures it. Later writes must not substitute an intermediate value.
        const syncPreviousValue =
          firstSyncOperation?.type === `update` &&
          currentVisibleState.get(key) === firstSyncOperation.value
            ? firstSyncOperation.previousValue
            : undefined
        const previousVisibleValue =
          !hasTruncateSync &&
          !previousOptimisticUpserts.has(key) &&
          !previousOptimisticDeletes.has(key) &&
          syncPreviousValue !== undefined
            ? syncPreviousValue
            : currentVisibleState.get(key)
        const newVisibleValue = this.get(key) // This returns the new derived state
        const previousVirtualProps =
          this.preSyncVirtualState.get(key) ??
          this.getVirtualPropsSnapshotForState(key, {
            rowOrigins: previousRowOrigins,
            optimisticUpserts: previousOptimisticUpserts,
            optimisticDeletes: previousOptimisticDeletes,
            completedOptimisticKeys,
          })
        const nextVirtualProps = this.getVirtualPropsSnapshotForState(key)
        const virtualChanged =
          previousVirtualProps.$synced !== nextVirtualProps.$synced ||
          previousVirtualProps.$origin !== nextVirtualProps.$origin
        const withPreviousVirtualProps = (value: TOutput) =>
          enrichRowWithVirtualProps(
            value,
            key,
            this.collection.id,
            () => previousVirtualProps.$synced,
            () => previousVirtualProps.$origin,
          )

        if (previousVisibleValue === undefined) {
          if (newVisibleValue === undefined) continue
          // Subscribers last saw this key absent, whatever a completed
          // optimistic request held. Batching composes a buffered delete with
          // this insert into an update.
          events.push({ type: `insert`, key, value: newVisibleValue })
        } else if (newVisibleValue === undefined) {
          events.push({
            type: `delete`,
            key,
            value: withPreviousVirtualProps(previousVisibleValue),
          })
        } else if (
          virtualChanged ||
          !deepEquals(previousVisibleValue, newVisibleValue)
        ) {
          events.push({
            type: `update`,
            key,
            value: newVisibleValue,
            previousValue: withPreviousVirtualProps(previousVisibleValue),
          })
        }
      }

      // Update cached size after synced data changes
      this.size = this.calculateSize()

      // Update indexes for all events before emitting
      if (events.length > 0) {
        this.indexes.updateIndexes(events)
      }

      // End batching and emit all events (combines any batched events with sync events)
      let failure: { error: unknown } | undefined
      try {
        const visibleLayoutChanged =
          previousLayout !== undefined &&
          (previousLayout.length !== this.size ||
            [...this.keys()].some(
              (key, index) => key !== previousLayout[index],
            ))
        this.changes.emitEvents(events, true, visibleLayoutChanged)
      } catch (error) {
        failure = { error }
      }

      if (this.syncRunGeneration === syncRunGeneration) {
        this.preSyncVisibleState.clear()
        this.preSyncVirtualState.clear()
        Promise.resolve().then(() => {
          if (this.syncRunGeneration === syncRunGeneration) {
            this.recentlySyncedKeys.clear()
          }
        })
        this.hasReceivedFirstCommit = true
      }

      for (const transaction of committedSyncedTransactions) {
        transaction.applied.resolve()
      }

      return { processed: true, failure }
    }

    return { processed: false }
  }

  /** Abandons a queued transaction and invalidated dependents before visibility. */
  public cancelPendingSyncedTransaction(
    transaction: PendingSyncedTransaction<TOutput, TKey>,
    reason: Error = new SyncTransactionAbortedError(),
  ): void {
    if (transaction.applicationStarted) return

    const index = this.pendingSyncedTransactions.indexOf(transaction)
    if (index === -1) return

    const canceledKeys = new Set<TKey>()
    const cancel = (
      pending: PendingSyncedTransaction<TOutput, TKey>,
      error: Error,
    ) => {
      const pendingIndex = this.pendingSyncedTransactions.indexOf(pending)
      if (pendingIndex === -1 || pending.applicationStarted) return
      this.pendingSyncedTransactions.splice(pendingIndex, 1)
      for (const operation of pending.operations) {
        canceledKeys.add(operation.key as TKey)
      }
      pending.applied.reject(error)
    }

    cancel(transaction, reason)

    // Admission can depend on earlier queued writes. After cancellation,
    // replay the queue with the same classifier used by normal admission.
    // Committed invalid dependents are rejected now. An active invalidated
    // transaction stays addressable until its caller invokes commit().
    const invalid = this.rebuildPendingSyncedProjection()
    for (const key of this.rejectInvalidCommittedTransactions(invalid)) {
      canceledKeys.add(key)
    }

    const remainingPendingKeys = new Set<TKey>()
    for (const pending of this.pendingSyncedTransactions) {
      if (pending.invalidationError !== undefined) continue
      for (const operation of pending.operations) {
        remainingPendingKeys.add(operation.key as TKey)
      }
    }
    for (const key of canceledKeys) {
      if (!remainingPendingKeys.has(key)) {
        this.recentlySyncedKeys.delete(key)
        this.preSyncVisibleState.delete(key)
        this.preSyncVirtualState.delete(key)
      }
    }

    if (this.pendingSyncedTransactions.length === 0) {
      this.preSyncVisibleState.clear()
      this.preSyncVirtualState.clear()
      this.recentlySyncedKeys.clear()
      this.changes.emitEvents([], true)
    } else {
      // Recompute after removing the canceled keys so optimistic cleanup is
      // no longer suppressed by a sync transaction that will never publish.
      this.recomputeOptimisticState(false)
    }
  }

  /**
   * Schedule cleanup of a transaction when it completes
   */
  public scheduleTransactionCleanup(transaction: Transaction<any>): void {
    // Only schedule cleanup for transactions that aren't already completed
    if (transaction.state === `completed`) {
      this.transactions.delete(transaction.id)
      return
    }

    // Schedule cleanup when the transaction completes
    transaction.isPersisted.promise
      .then(() => {
        // Transaction completed successfully, remove it immediately
        this.transactions.delete(transaction.id)
      })
      .catch(() => {
        // Transaction failed, but we want to keep failed transactions for reference
        // so don't remove it.
        // Rollback already triggers state recomputation via touchCollection().
      })
  }

  /**
   * Capture visible state for keys that will be affected by pending sync operations
   * This must be called BEFORE onTransactionStateChange clears optimistic state
   */
  public capturePreSyncVisibleState(): void {
    if (this.pendingSyncedTransactions.length === 0) return

    // Get all keys that will be affected by sync operations
    const syncedKeys = new Set<TKey>()
    for (const transaction of this.pendingSyncedTransactions) {
      for (const operation of transaction.operations) {
        syncedKeys.add(operation.key as TKey)
      }
    }

    // Mark keys as about to be synced to suppress intermediate events from recomputeOptimisticState
    for (const key of syncedKeys) {
      this.recentlySyncedKeys.add(key)
    }

    // Only capture current visible state for keys that will be affected by sync operations
    // This is much more efficient than capturing the entire collection state
    // Only capture keys that haven't been captured yet to preserve earlier captures
    for (const key of syncedKeys) {
      if (!this.preSyncVisibleState.has(key)) {
        const currentValue = this.get(key)
        this.preSyncVisibleState.set(key, currentValue)
        if (currentValue !== undefined) {
          this.preSyncVirtualState.set(
            key,
            this.getVirtualPropsSnapshotForState(key),
          )
        }
      }
    }
  }

  /**
   * Trigger a recomputation when transactions change
   * This method should be called by the Transaction class when state changes
   */
  public onTransactionStateChange(): void {
    // Batch only when the next sync drain can actually publish. A persisting
    // sibling can keep normal sync queued; it must not hide this rollback.
    const hasPersistingTransaction = [...this.transactions.values()].some(
      (transaction) => transaction.state === `persisting`,
    )
    this.changes.shouldBatchEvents = this.pendingSyncedTransactions.some(
      (transaction) =>
        transaction.committed &&
        (!hasPersistingTransaction ||
          transaction.immediate ||
          transaction.truncate),
    )

    // CRITICAL: Capture visible state BEFORE clearing optimistic state
    if (this.changes.shouldBatchEvents) this.capturePreSyncVisibleState()

    this.recomputeOptimisticState(false)
  }

  /**
   * Clean up the collection by stopping sync and clearing data
   * This can be called manually or automatically by garbage collection
   */
  public cleanup(): void {
    this.syncRunGeneration++
    for (const transaction of this.pendingSyncedTransactions) {
      transaction.applied.reject(new SyncTransactionAbortedError())
    }
    this.syncedData.clear()
    this.syncedMetadata.clear()
    this.syncedCollectionMetadata.clear()
    this.optimisticUpserts.clear()
    this.optimisticDeletes.clear()
    this.pendingOptimisticUpserts.clear()
    this.pendingOptimisticDeletes.clear()
    this.pendingOptimisticDirectUpserts.clear()
    this.pendingOptimisticDirectDeletes.clear()
    this.hydrationSeedKeys.clear()
    this.hydratedKeys.clear()
    this.appliedAdapterDeletedKeys?.clear()
    this.hasAppliedAdapterTruncate = false
    this.clearOriginTrackingState()
    this.isLocalOnly = false
    this.size = 0
    this.pendingSyncedTransactions = []
    this.pendingSyncedProjection = { states: new Map(), truncated: false }
    this.preSyncVisibleState.clear()
    this.preSyncVirtualState.clear()
    this.recentlySyncedKeys.clear()
    this.hasReceivedFirstCommit = false
  }
}
