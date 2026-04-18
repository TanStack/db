import { deepEquals } from '../utils'
import { SortedMap } from '../SortedMap'
import { enrichRowWithVirtualProps } from '../virtual-props.js'
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
} from '../types'
import type { CollectionImpl } from './index.js'
import type { CollectionLifecycleManager } from './lifecycle'
import type { CollectionChangesManager } from './changes'
import type { CollectionIndexesManager } from './indexes'
import type { CollectionEventsManager } from './events'

interface PendingSyncedTransaction<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> {
  committed: boolean
  operations: Array<OptimisticChangeMessage<T>>
  truncate?: boolean
  deletedKeys: Set<string | number>
  rowMetadataWrites: Map<TKey, PendingMetadataWrite>
  collectionMetadataWrites: Map<string, PendingMetadataWrite>
  optimisticSnapshot?: {
    upserts: Map<TKey, T>
    deletes: Set<TKey>
  }
  /**
   * When true, this transaction should be processed immediately even if there
   * are persisting user transactions. Used by manual write operations (writeInsert,
   * writeUpdate, writeDelete, writeUpsert) which need synchronous updates to syncedData.
   */
  immediate?: boolean
}

type PendingMetadataWrite = { type: `set`; value: unknown } | { type: `delete` }

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
  public config!: CollectionConfig<TOutput, TKey, TSchema>
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
  public syncedData: SortedMap<TKey, TOutput>
  public syncedMetadata = new Map<TKey, unknown>()
  public syncedCollectionMetadata = new Map<string, unknown>()

  // Optimistic state tracking - make public for testing
  public optimisticUpserts = new Map<TKey, TOutput>()
  public optimisticDeletes = new Set<TKey>()
  public pendingOptimisticUpserts = new Map<TKey, TOutput>()
  public pendingOptimisticDeletes = new Set<TKey>()
  public pendingOptimisticDirectUpserts = new Set<TKey>()
  public pendingOptimisticDirectDeletes = new Set<TKey>()

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
  public syncedKeys = new Set<TKey>()
  public preSyncVisibleState = new Map<TKey, TOutput>()
  public recentlySyncedKeys = new Set<TKey>()
  public hasReceivedFirstCommit = false
  public isCommittingSyncTransactions = false

  /**
   * Collects previousValue from sync update operations within a single
   * commitPendingTransactions call. When a sync source (e.g. a Yjs-backed
   * collection using live-reading proxy objects) provides previousValue
   * on an update message, it takes precedence over the captured
   * currentVisibleState for the deepEquals comparison.
   *
   * This allows live-reading proxy objects to work correctly as collection
   * values — the proxy always returns the current state, but the sync
   * source knows the previous state from its own diff system (e.g. Yjs
   * delta's SetAttrOp.prevValue).
   */
  private _syncPreviousValues: Map<TKey, TOutput> | null = null
  public isLocalOnly = false

  /**
   * Creates a new CollectionState manager
   */
  constructor(config: CollectionConfig<TOutput, TKey, TSchema>) {
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
   * Checks if a row has pending optimistic mutations (not yet confirmed by sync).
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
    return {
      $synced: overrides?.$synced ?? this.isRowSynced(key),
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
      completedOptimisticKeys?: Pick<Map<TKey, unknown>, 'has'>
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
    const previousRowOrigins = new Map(this.rowOrigins)

    // Update pending optimistic state for completed/failed transactions
    for (const transaction of this.transactions.values()) {
      const isDirectTransaction =
        transaction.metadata[DIRECT_TRANSACTION_METADATA_KEY] === true
      if (transaction.state === `completed`) {
        for (const mutation of transaction.mutations) {
          if (!this.isThisCollection(mutation.collection)) {
            continue
          }
          this.pendingLocalOrigins.add(mutation.key)
          if (!mutation.optimistic) {
            continue
          }
          switch (mutation.type) {
            case `insert`:
            case `update`:
              this.pendingOptimisticUpserts.set(
                mutation.key,
                mutation.modified as TOutput,
              )
              this.pendingOptimisticDeletes.delete(mutation.key)
              if (isDirectTransaction) {
                this.pendingOptimisticDirectUpserts.add(mutation.key)
                this.pendingOptimisticDirectDeletes.delete(mutation.key)
              } else {
                this.pendingOptimisticDirectUpserts.delete(mutation.key)
                this.pendingOptimisticDirectDeletes.delete(mutation.key)
              }
              break
            case `delete`:
              this.pendingOptimisticUpserts.delete(mutation.key)
              this.pendingOptimisticDeletes.add(mutation.key)
              if (isDirectTransaction) {
                this.pendingOptimisticDirectUpserts.delete(mutation.key)
                this.pendingOptimisticDirectDeletes.add(mutation.key)
              } else {
                this.pendingOptimisticDirectUpserts.delete(mutation.key)
                this.pendingOptimisticDirectDeletes.delete(mutation.key)
              }
              break
          }
        }
      } else if (transaction.state === `failed`) {
        for (const mutation of transaction.mutations) {
          if (!this.isThisCollection(mutation.collection)) {
            continue
          }
          this.pendingLocalOrigins.delete(mutation.key)
          if (mutation.optimistic) {
            this.pendingOptimisticUpserts.delete(mutation.key)
            this.pendingOptimisticDeletes.delete(mutation.key)
            this.pendingOptimisticDirectUpserts.delete(mutation.key)
            this.pendingOptimisticDirectDeletes.delete(mutation.key)
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
        this.optimisticUpserts.set(key, value)
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

    const activeTransactions: Array<Transaction<any>> = []

    for (const transaction of this.transactions.values()) {
      if (![`completed`, `failed`].includes(transaction.state)) {
        activeTransactions.push(transaction)
      }
    }

    // Apply active transactions only (completed transactions are handled by sync operations)
    for (const transaction of activeTransactions) {
      for (const mutation of transaction.mutations) {
        if (!this.isThisCollection(mutation.collection)) {
          continue
        }

        // Track that this key has pending local changes for $origin tracking
        this.pendingLocalChanges.add(mutation.key)

        if (mutation.optimistic) {
          switch (mutation.type) {
            case `insert`:
            case `update`:
              this.optimisticUpserts.set(
                mutation.key,
                mutation.modified as TOutput,
              )
              this.optimisticDeletes.delete(mutation.key)
              break
            case `delete`:
              this.optimisticUpserts.delete(mutation.key)
              this.optimisticDeletes.add(mutation.key)
              break
          }
        }
      }
    }

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

    // Filter out events for recently synced keys to prevent duplicates
    // BUT: Only filter out events that are actually from sync operations
    // New user transactions should NOT be filtered even if the key was recently synced
    const filteredEventsBySyncStatus = events.filter((event) => {
      if (!this.recentlySyncedKeys.has(event.key)) {
        return true // Key not recently synced, allow event through
      }

      // Key was recently synced - allow if this is a user-triggered action
      if (triggeredByUserAction) {
        return true
      }

      // Otherwise filter out duplicate sync events
      return false
    })

    // Filter out redundant delete events if there are pending sync transactions
    // that will immediately restore the same data, but only for completed transactions
    // IMPORTANT: Skip complex filtering for user-triggered actions to prevent UI blocking
    if (this.pendingSyncedTransactions.length > 0 && !triggeredByUserAction) {
      const pendingSyncKeysForFilter = new Set<TKey>()

      // Collect keys from pending sync operations
      for (const transaction of this.pendingSyncedTransactions) {
        for (const operation of transaction.operations) {
          pendingSyncKeysForFilter.add(operation.key as TKey)
        }
      }

      // Only filter out delete events for keys that:
      // 1. Have pending sync operations AND
      // 2. Are from completed transactions (being cleaned up)
      const filteredEvents = filteredEventsBySyncStatus.filter((event) => {
        if (
          event.type === `delete` &&
          pendingSyncKeysForFilter.has(event.key)
        ) {
          // Check if this delete is from clearing optimistic state of completed transactions
          // We can infer this by checking if we have no remaining optimistic mutations for this key
          const hasActiveOptimisticMutation = activeTransactions.some((tx) =>
            tx.mutations.some(
              (m) => this.isThisCollection(m.collection) && m.key === event.key,
            ),
          )

          if (!hasActiveOptimisticMutation) {
            return false // Skip this delete event as sync will restore the data
          }
        }
        return true
      })

      // Update indexes for the filtered events
      if (filteredEvents.length > 0) {
        this.indexes.updateIndexes(filteredEvents)
      }
      this.changes.emitEvents(filteredEvents, triggeredByUserAction)
    } else {
      // Update indexes for all events
      if (filteredEventsBySyncStatus.length > 0) {
        this.indexes.updateIndexes(filteredEventsBySyncStatus)
      }
      // Emit all events if no pending sync transactions
      this.changes.emitEvents(filteredEventsBySyncStatus, triggeredByUserAction)
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
        previousValue !== currentValue
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

  /**
   * Attempts to commit pending synced transactions if there are no active transactions
   * This method processes operations from pending transactions and applies them to the synced data
   */
  commitPendingTransactions = () => {
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
    const {
      committedSyncedTransactions,
      uncommittedSyncedTransactions,
      hasTruncateSync,
      hasImmediateSync,
    } = this.pendingSyncedTransactions.reduce(
      (acc, t) => {
        if (t.committed) {
          acc.committedSyncedTransactions.push(t)
          if (t.truncate) {
            acc.hasTruncateSync = true
          }
          if (t.immediate) {
            acc.hasImmediateSync = true
          }
        } else {
          acc.uncommittedSyncedTransactions.push(t)
        }
        return acc
      },
      {
        committedSyncedTransactions: [] as Array<
          PendingSyncedTransaction<TOutput, TKey>
        >,
        uncommittedSyncedTransactions: [] as Array<
          PendingSyncedTransaction<TOutput, TKey>
        >,
        hasTruncateSync: false,
        hasImmediateSync: false,
      },
    )

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
      // Set flag to prevent redundant optimistic state recalculations
      this.isCommittingSyncTransactions = true

      const previousRowOrigins = new Map(this.rowOrigins)
      const previousOptimisticUpserts = new Map(this.optimisticUpserts)
      const previousOptimisticDeletes = new Set(this.optimisticDeletes)

      // Get the optimistic snapshot from the truncate transaction (captured when truncate() was called)
      const truncateOptimisticSnapshot = hasTruncateSync
        ? committedSyncedTransactions.find((t) => t.truncate)
            ?.optimisticSnapshot
        : null
      let truncatePendingLocalChanges: Set<TKey> | undefined
      let truncatePendingLocalOrigins: Set<TKey> | undefined

      // First collect all keys that will be affected by sync operations
      const changedKeys = new Set<TKey>()
      for (const transaction of committedSyncedTransactions) {
        for (const operation of transaction.operations) {
          changedKeys.add(operation.key as TKey)
        }
        for (const [key] of transaction.rowMetadataWrites) {
          changedKeys.add(key)
        }
      }

      // Use pre-captured state if available (from optimistic scenarios),
      // otherwise capture current state (for pure sync scenarios)
      let currentVisibleState = this.preSyncVisibleState
      if (currentVisibleState.size === 0) {
        // No pre-captured state, capture it now for pure sync operations
        currentVisibleState = new Map<TKey, TOutput>()
        for (const key of changedKeys) {
          const currentValue = this.get(key)
          if (currentValue !== undefined) {
            currentVisibleState.set(key, currentValue)
          }
        }
      }

      const events: Array<ChangeMessage<TOutput, TKey>> = []
      const rowUpdateMode = this.config.sync.rowUpdateMode || `partial`
      const completedOptimisticOps = new Map<
        TKey,
        { type: string; value: TOutput }
      >()

      for (const transaction of this.transactions.values()) {
        if (transaction.state === `completed`) {
          for (const mutation of transaction.mutations) {
            if (this.isThisCollection(mutation.collection)) {
              if (mutation.optimistic) {
                completedOptimisticOps.set(mutation.key, {
                  type: mutation.type,
                  value: mutation.modified as TOutput,
                })
              }
            }
          }
        }
      }

      for (const transaction of committedSyncedTransactions) {
        // Handle truncate operations first
        if (transaction.truncate) {
          // TRUNCATE PHASE
          // 1) Emit a delete for every visible key (synced + optimistic) so downstream listeners/indexes
          //    observe a clear-before-rebuild. We intentionally skip keys already in
          //    optimisticDeletes because their delete was previously emitted by the user.
          // Use the snapshot to ensure we emit deletes for all items that existed at truncate start.
          const visibleKeys = new Set([
            ...this.syncedData.keys(),
            ...(truncateOptimisticSnapshot?.upserts.keys() || []),
          ])
          for (const key of visibleKeys) {
            if (truncateOptimisticSnapshot?.deletes.has(key)) continue
            const previousValue =
              truncateOptimisticSnapshot?.upserts.get(key) ||
              this.syncedData.get(key)
            if (previousValue !== undefined) {
              events.push({ type: `delete`, key, value: previousValue })
            }
          }

          // 2) Clear the authoritative synced base. Subsequent server ops in this
          //    same commit will rebuild the base atomically.
          // Preserve pending local tracking just long enough for operations in this
          // truncate batch to retain correct local origin semantics.
          truncatePendingLocalChanges = new Set(this.pendingLocalChanges)
          truncatePendingLocalOrigins = new Set(this.pendingLocalOrigins)
          this.syncedData.clear()
          this.syncedMetadata.clear()
          this.syncedKeys.clear()
          this.clearOriginTrackingState()

          // 3) Clear currentVisibleState for truncated keys to ensure subsequent operations
          //    are compared against the post-truncate state (undefined) rather than pre-truncate state
          //    This ensures that re-inserted keys are emitted as INSERT events, not UPDATE events
          for (const key of changedKeys) {
            currentVisibleState.delete(key)
          }

          // 4) Emit truncate event so subscriptions can reset their cursor tracking state
          this._events.emit(`truncate`, {
            type: `truncate`,
            collection: this.collection,
          })
        }

        for (const operation of transaction.operations) {
          const key = operation.key as TKey
          this.syncedKeys.add(key)

          // Collect sync-provided previousValue for live-proxy-aware diffing.
          // Only store the first previousValue per key within a batch — for
          // multi-step updates (A→B→C), the pre-batch value (A) is the
          // correct previousValue, not the intermediate (B).
          if (
            operation.type === `update` &&
            `previousValue` in operation &&
            operation.previousValue !== undefined
          ) {
            if (this._syncPreviousValues === null) {
              this._syncPreviousValues = new Map()
            }
            if (!this._syncPreviousValues.has(key)) {
              this._syncPreviousValues.set(key, operation.previousValue)
            }
          }

          // Determine origin: 'local' for local-only collections or pending local changes
          const origin: VirtualOrigin =
            this.isLocalOnly ||
            this.pendingLocalChanges.has(key) ||
            this.pendingLocalOrigins.has(key) ||
            truncatePendingLocalChanges?.has(key) === true ||
            truncatePendingLocalOrigins?.has(key) === true
              ? 'local'
              : 'remote'

          // Update synced data
          switch (operation.type) {
            case `insert`:
              this.syncedData.set(key, operation.value)
              this.rowOrigins.set(key, origin)
              // Clear pending local changes now that sync has confirmed
              this.pendingLocalChanges.delete(key)
              this.pendingLocalOrigins.delete(key)
              this.pendingOptimisticUpserts.delete(key)
              this.pendingOptimisticDeletes.delete(key)
              this.pendingOptimisticDirectUpserts.delete(key)
              this.pendingOptimisticDirectDeletes.delete(key)
              break
            case `update`: {
              if (rowUpdateMode === `partial`) {
                const updatedValue = Object.assign(
                  {},
                  this.syncedData.get(key),
                  operation.value,
                )
                this.syncedData.set(key, updatedValue)
              } else {
                this.syncedData.set(key, operation.value)
              }
              this.rowOrigins.set(key, origin)
              // Clear pending local changes now that sync has confirmed
              this.pendingLocalChanges.delete(key)
              this.pendingLocalOrigins.delete(key)
              this.pendingOptimisticUpserts.delete(key)
              this.pendingOptimisticDeletes.delete(key)
              this.pendingOptimisticDirectUpserts.delete(key)
              this.pendingOptimisticDirectDeletes.delete(key)
              break
            }
            case `delete`:
              this.syncedData.delete(key)
              this.syncedMetadata.delete(key)
              // Clean up origin and pending tracking for deleted rows
              this.rowOrigins.delete(key)
              this.pendingLocalChanges.delete(key)
              this.pendingLocalOrigins.delete(key)
              this.pendingOptimisticUpserts.delete(key)
              this.pendingOptimisticDeletes.delete(key)
              this.pendingOptimisticDirectUpserts.delete(key)
              this.pendingOptimisticDirectDeletes.delete(key)
              break
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

      // After applying synced operations, if this commit included a truncate,
      // re-apply optimistic mutations on top of the fresh synced base. This ensures
      // the UI preserves local intent while respecting server rebuild semantics.
      // Ordering: deletes (above) -> server ops (just applied) -> optimistic upserts.
      if (hasTruncateSync) {
        // Avoid duplicating keys that were inserted/updated by synced operations in this commit
        const syncedInsertedOrUpdatedKeys = new Set<TKey>()
        for (const t of committedSyncedTransactions) {
          for (const op of t.operations) {
            if (op.type === `insert` || op.type === `update`) {
              syncedInsertedOrUpdatedKeys.add(op.key as TKey)
            }
          }
        }

        // Build re-apply sets from the snapshot taken at the start of this function.
        // This prevents losing optimistic state if transactions complete during truncate processing.
        const reapplyUpserts = new Map<TKey, TOutput>(
          truncateOptimisticSnapshot!.upserts,
        )
        const reapplyDeletes = new Set<TKey>(
          truncateOptimisticSnapshot!.deletes,
        )

        // Emit inserts for re-applied upserts, skipping any keys that have an optimistic delete.
        // If the server also inserted/updated the same key in this batch, override that value
        // with the optimistic value to preserve local intent.
        for (const [key, value] of reapplyUpserts) {
          if (reapplyDeletes.has(key)) continue
          if (syncedInsertedOrUpdatedKeys.has(key)) {
            let foundInsert = false
            for (let i = events.length - 1; i >= 0; i--) {
              const evt = events[i]!
              if (evt.key === key && evt.type === `insert`) {
                evt.value = value
                foundInsert = true
                break
              }
            }
            if (!foundInsert) {
              events.push({ type: `insert`, key, value })
            }
          } else {
            events.push({ type: `insert`, key, value })
          }
        }

        // Finally, ensure we do NOT insert keys that have an outstanding optimistic delete.
        if (events.length > 0 && reapplyDeletes.size > 0) {
          const filtered: Array<ChangeMessage<TOutput, TKey>> = []
          for (const evt of events) {
            if (evt.type === `insert` && reapplyDeletes.has(evt.key)) {
              continue
            }
            filtered.push(evt)
          }
          events.length = 0
          events.push(...filtered)
        }

        // Ensure listeners are active before emitting this critical batch
        if (this.lifecycle.status !== `ready`) {
          this.lifecycle.markReady()
        }
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
        for (const [key, value] of truncateOptimisticSnapshot.upserts) {
          this.optimisticUpserts.set(key, value)
        }
        for (const key of truncateOptimisticSnapshot.deletes) {
          this.optimisticDeletes.add(key)
        }
      }

      // Always overlay any still-active optimistic transactions so mutations that started
      // after the truncate snapshot are preserved.
      for (const transaction of this.transactions.values()) {
        if (![`completed`, `failed`].includes(transaction.state)) {
          for (const mutation of transaction.mutations) {
            if (
              this.isThisCollection(mutation.collection) &&
              mutation.optimistic
            ) {
              switch (mutation.type) {
                case `insert`:
                case `update`:
                  this.optimisticUpserts.set(
                    mutation.key,
                    mutation.modified as TOutput,
                  )
                  this.optimisticDeletes.delete(mutation.key)
                  break
                case `delete`:
                  this.optimisticUpserts.delete(mutation.key)
                  this.optimisticDeletes.add(mutation.key)
                  break
              }
            }
          }
        }
      }

      // Retrieve and clear sync-provided previousValues for this commit
      const syncPreviousValues = this._syncPreviousValues
      this._syncPreviousValues = null

      // Now check what actually changed in the final visible state
      for (const key of changedKeys) {
        // If the sync source provided a previousValue (e.g. from a Yjs delta),
        // use it instead of the captured currentVisibleState. This is necessary
        // when collection values are live-reading proxy objects — the proxy
        // returns the current (post-mutation) state at capture time, making
        // the before/after indistinguishable. The sync source's previousValue
        // carries the actual pre-mutation state from its own diff system.
        const previousVisibleValue = syncPreviousValues?.get(key) ?? currentVisibleState.get(key)
        const newVisibleValue = this.get(key) // This returns the new derived state
        const previousVirtualProps = this.getVirtualPropsSnapshotForState(key, {
          rowOrigins: previousRowOrigins,
          optimisticUpserts: previousOptimisticUpserts,
          optimisticDeletes: previousOptimisticDeletes,
          completedOptimisticKeys: completedOptimisticOps,
        })
        const nextVirtualProps = this.getVirtualPropsSnapshotForState(key)
        const virtualChanged =
          previousVirtualProps.$synced !== nextVirtualProps.$synced ||
          previousVirtualProps.$origin !== nextVirtualProps.$origin
        const previousValueWithVirtual =
          previousVisibleValue !== undefined
            ? enrichRowWithVirtualProps(
                previousVisibleValue,
                key,
                this.collection.id,
                () => previousVirtualProps.$synced,
                () => previousVirtualProps.$origin,
              )
            : undefined

        // Check if this sync operation is redundant with a completed optimistic operation
        const completedOp = completedOptimisticOps.get(key)
        let isRedundantSync = false

        if (completedOp) {
          if (
            completedOp.type === `delete` &&
            previousVisibleValue !== undefined &&
            newVisibleValue === undefined &&
            deepEquals(completedOp.value, previousVisibleValue)
          ) {
            isRedundantSync = true
          } else if (
            newVisibleValue !== undefined &&
            deepEquals(completedOp.value, newVisibleValue)
          ) {
            isRedundantSync = true
          }
        }

        const shouldEmitVirtualUpdate =
          virtualChanged &&
          previousVisibleValue !== undefined &&
          newVisibleValue !== undefined &&
          deepEquals(previousVisibleValue, newVisibleValue)

        if (isRedundantSync && !shouldEmitVirtualUpdate) {
          continue
        }

        if (
          previousVisibleValue === undefined &&
          newVisibleValue !== undefined
        ) {
          const completedOptimisticOp = completedOptimisticOps.get(key)
          if (completedOptimisticOp) {
            const previousValueFromCompleted = completedOptimisticOp.value
            const previousValueWithVirtualFromCompleted =
              enrichRowWithVirtualProps(
                previousValueFromCompleted,
                key,
                this.collection.id,
                () => previousVirtualProps.$synced,
                () => previousVirtualProps.$origin,
              )
            events.push({
              type: `update`,
              key,
              value: newVisibleValue,
              previousValue: previousValueWithVirtualFromCompleted,
            })
          } else {
            events.push({
              type: `insert`,
              key,
              value: newVisibleValue,
            })
          }
        } else if (
          previousVisibleValue !== undefined &&
          newVisibleValue === undefined
        ) {
          events.push({
            type: `delete`,
            key,
            value: previousValueWithVirtual ?? previousVisibleValue,
          })
        } else if (
          previousVisibleValue !== undefined &&
          newVisibleValue !== undefined &&
          (!deepEquals(previousVisibleValue, newVisibleValue) ||
            shouldEmitVirtualUpdate)
        ) {
          events.push({
            type: `update`,
            key,
            value: newVisibleValue,
            previousValue: previousValueWithVirtual ?? previousVisibleValue,
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
      this.changes.emitEvents(events, true)

      this.pendingSyncedTransactions = uncommittedSyncedTransactions

      // Clear the pre-sync state since sync operations are complete
      this.preSyncVisibleState.clear()

      // Clear recently synced keys after a microtask to allow recomputeOptimisticState to see them
      Promise.resolve().then(() => {
        this.recentlySyncedKeys.clear()
      })

      // Mark that we've received the first commit (for tracking purposes)
      if (!this.hasReceivedFirstCommit) {
        this.hasReceivedFirstCommit = true
      }
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
        if (currentValue !== undefined) {
          this.preSyncVisibleState.set(key, currentValue)
        }
      }
    }
  }

  /**
   * Trigger a recomputation when transactions change
   * This method should be called by the Transaction class when state changes
   */
  public onTransactionStateChange(): void {
    // Check if commitPendingTransactions will be called after this
    // by checking if there are pending sync transactions (same logic as in transactions.ts)
    this.changes.shouldBatchEvents = this.pendingSyncedTransactions.length > 0

    // CRITICAL: Capture visible state BEFORE clearing optimistic state
    this.capturePreSyncVisibleState()

    this.recomputeOptimisticState(false)
  }

  /**
   * Clean up the collection by stopping sync and clearing data
   * This can be called manually or automatically by garbage collection
   */
  public cleanup(): void {
    this.syncedData.clear()
    this.syncedMetadata.clear()
    this.syncedCollectionMetadata.clear()
    this.optimisticUpserts.clear()
    this.optimisticDeletes.clear()
    this.pendingOptimisticUpserts.clear()
    this.pendingOptimisticDeletes.clear()
    this.pendingOptimisticDirectUpserts.clear()
    this.pendingOptimisticDirectDeletes.clear()
    this.clearOriginTrackingState()
    this.isLocalOnly = false
    this.size = 0
    this.pendingSyncedTransactions = []
    this.syncedKeys.clear()
    this.hasReceivedFirstCommit = false
  }
}
