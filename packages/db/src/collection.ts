import { withArrayChangeTracking, withChangeTracking } from "./proxy"
import { SortedMap } from "./SortedMap"
import {
  createSingleRowRefProxy,
  toExpression,
} from "./query/builder/ref-proxy"
import { BTreeIndex } from "./indexes/btree-index.js"
import { IndexProxy, LazyIndexWrapper } from "./indexes/lazy-index.js"
import { ensureIndexForExpression } from "./indexes/auto-index.js"
import { createTransaction, getActiveTransaction } from "./transactions"
import {
  CollectionInErrorStateError,
  CollectionIsInErrorStateError,
  CollectionRequiresConfigError,
  CollectionRequiresSyncConfigError,
  DeleteKeyNotFoundError,
  DuplicateKeyError,
  DuplicateKeySyncError,
  InvalidCollectionStatusTransitionError,
  InvalidSchemaError,
  KeyUpdateNotAllowedError,
  MissingDeleteHandlerError,
  MissingInsertHandlerError,
  MissingUpdateArgumentError,
  MissingUpdateHandlerError,
  NegativeActiveSubscribersError,
  NoKeysPassedToDeleteError,
  NoKeysPassedToUpdateError,
  NoPendingSyncTransactionCommitError,
  NoPendingSyncTransactionWriteError,
  SchemaMustBeSynchronousError,
  SchemaValidationError,
  SyncCleanupError,
  SyncTransactionAlreadyCommittedError,
  SyncTransactionAlreadyCommittedWriteError,
  UndefinedKeyError,
  UpdateKeyNotFoundError,
} from "./errors"
import { createFilteredCallback, currentStateAsChanges } from "./change-events"
import type { Transaction } from "./transactions"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { SingleRowRefProxy } from "./query/builder/ref-proxy"
import type {
  ChangeListener,
  ChangeMessage,
  CollectionConfig,
  CollectionStatus,
  CurrentStateAsChangesOptions,
  Fn,
  InsertConfig,
  OperationConfig,
  OptimisticChangeMessage,
  PendingMutation,
  ResolveInsertInput,
  ResolveType,
  StandardSchema,
  SubscribeChangesOptions,
  Transaction as TransactionType,
  TransactionWithMutations,
  UtilsRecord,
} from "./types"
import type { IndexOptions } from "./indexes/index-options.js"
import type { BaseIndex, IndexResolver } from "./indexes/base-index.js"

interface PendingSyncedTransaction<T extends object = Record<string, unknown>> {
  committed: boolean
  operations: Array<OptimisticChangeMessage<T>>
}

/**
 * Enhanced Collection interface that includes both data type T and utilities TUtils
 * @template T - The type of items in the collection
 * @template TKey - The type of the key for the collection
 * @template TUtils - The utilities record type
 * @template TInsertInput - The type for insert operations (can be different from T for schemas with defaults)
 */
export interface Collection<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TUtils extends UtilsRecord = {},
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInsertInput extends object = T,
> extends CollectionImpl<T, TKey, TUtils, TSchema, TInsertInput> {
  readonly utils: TUtils
}

/**
 * Creates a new Collection instance with the given configuration
 *
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TKey - The type of the key for the collection
 * @template TUtils - The utilities record type
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 * @param options - Collection options with optional utilities
 * @returns A new Collection with utilities exposed both at top level and under .utils
 *
 * @example
 * // Pattern 1: With operation handlers (direct collection calls)
 * const todos = createCollection({
 *   id: "todos",
 *   getKey: (todo) => todo.id,
 *   schema,
 *   onInsert: async ({ transaction, collection }) => {
 *     // Send to API
 *     await api.createTodo(transaction.mutations[0].modified)
 *   },
 *   onUpdate: async ({ transaction, collection }) => {
 *     await api.updateTodo(transaction.mutations[0].modified)
 *   },
 *   onDelete: async ({ transaction, collection }) => {
 *     await api.deleteTodo(transaction.mutations[0].key)
 *   },
 *   sync: { sync: () => {} }
 * })
 *
 * // Direct usage (handlers manage transactions)
 * const tx = todos.insert({ id: "1", text: "Buy milk", completed: false })
 * await tx.isPersisted.promise
 *
 * @example
 * // Pattern 2: Manual transaction management
 * const todos = createCollection({
 *   getKey: (todo) => todo.id,
 *   schema: todoSchema,
 *   sync: { sync: () => {} }
 * })
 *
 * // Explicit transaction usage
 * const tx = createTransaction({
 *   mutationFn: async ({ transaction }) => {
 *     // Handle all mutations in transaction
 *     await api.saveChanges(transaction.mutations)
 *   }
 * })
 *
 * tx.mutate(() => {
 *   todos.insert({ id: "1", text: "Buy milk" })
 *   todos.update("2", draft => { draft.completed = true })
 * })
 *
 * await tx.isPersisted.promise
 *
 * @example
 * // Using schema for type inference (preferred as it also gives you client side validation)
 * const todoSchema = z.object({
 *   id: z.string(),
 *   title: z.string(),
 *   completed: z.boolean()
 * })
 *
 * const todos = createCollection({
 *   schema: todoSchema,
 *   getKey: (todo) => todo.id,
 *   sync: { sync: () => {} }
 * })
 *
 * // Note: You can provide an explicit type, a schema, or both. When both are provided, the explicit type takes precedence.
 */

// Overload for when schema is provided - infers schema type
export function createCollection<
  TSchema extends StandardSchemaV1,
  TKey extends string | number = string | number,
  TUtils extends UtilsRecord = {},
  TFallback extends object = Record<string, unknown>,
>(
  options: CollectionConfig<
    ResolveType<unknown, TSchema, TFallback>,
    TKey,
    TSchema,
    ResolveInsertInput<unknown, TSchema, TFallback>
  > & {
    schema: TSchema
    utils?: TUtils
  }
): Collection<
  ResolveType<unknown, TSchema, TFallback>,
  TKey,
  TUtils,
  TSchema,
  ResolveInsertInput<unknown, TSchema, TFallback>
>

// Overload for when explicit type is provided with schema - explicit type takes precedence
export function createCollection<
  TExplicit extends object,
  TKey extends string | number = string | number,
  TUtils extends UtilsRecord = {},
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TFallback extends object = Record<string, unknown>,
>(
  options: CollectionConfig<
    ResolveType<TExplicit, TSchema, TFallback>,
    TKey,
    TSchema,
    ResolveInsertInput<TExplicit, TSchema, TFallback>
  > & {
    schema: TSchema
    utils?: TUtils
  }
): Collection<
  ResolveType<TExplicit, TSchema, TFallback>,
  TKey,
  TUtils,
  TSchema,
  ResolveInsertInput<TExplicit, TSchema, TFallback>
>

// Overload for when explicit type is provided or no schema
export function createCollection<
  TExplicit = unknown,
  TKey extends string | number = string | number,
  TUtils extends UtilsRecord = {},
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TFallback extends object = Record<string, unknown>,
>(
  options: CollectionConfig<
    ResolveType<TExplicit, TSchema, TFallback>,
    TKey,
    TSchema,
    ResolveInsertInput<TExplicit, TSchema, TFallback>
  > & { utils?: TUtils }
): Collection<
  ResolveType<TExplicit, TSchema, TFallback>,
  TKey,
  TUtils,
  TSchema,
  ResolveInsertInput<TExplicit, TSchema, TFallback>
>

// Implementation
export function createCollection<
  TExplicit = unknown,
  TKey extends string | number = string | number,
  TUtils extends UtilsRecord = {},
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TFallback extends object = Record<string, unknown>,
>(
  options: CollectionConfig<
    ResolveType<TExplicit, TSchema, TFallback>,
    TKey,
    TSchema,
    ResolveInsertInput<TExplicit, TSchema, TFallback>
  > & { utils?: TUtils }
): Collection<
  ResolveType<TExplicit, TSchema, TFallback>,
  TKey,
  TUtils,
  TSchema,
  ResolveInsertInput<TExplicit, TSchema, TFallback>
> {
  const collection = new CollectionImpl<
    ResolveType<TExplicit, TSchema, TFallback>,
    TKey,
    TUtils,
    TSchema,
    ResolveInsertInput<TExplicit, TSchema, TFallback>
  >(options)

  // Copy utils to both top level and .utils namespace
  if (options.utils) {
    collection.utils = { ...options.utils }
  } else {
    collection.utils = {} as TUtils
  }

  return collection as Collection<
    ResolveType<TExplicit, TSchema, TFallback>,
    TKey,
    TUtils,
    TSchema,
    ResolveInsertInput<TExplicit, TSchema, TFallback>
  >
}

export class CollectionImpl<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TUtils extends UtilsRecord = {},
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInsertInput extends object = T,
> {
  public config: CollectionConfig<T, TKey, TSchema, TInsertInput>

  // Core state - make public for testing
  public transactions: SortedMap<string, Transaction<any>>
  public pendingSyncedTransactions: Array<PendingSyncedTransaction<T>> = []
  public syncedData: Map<TKey, T> | SortedMap<TKey, T>
  public syncedMetadata = new Map<TKey, unknown>()

  // Optimistic state tracking - make public for testing
  public optimisticUpserts = new Map<TKey, T>()
  public optimisticDeletes = new Set<TKey>()

  // Cached size for performance
  private _size = 0

  // Index storage
  private lazyIndexes = new Map<number, LazyIndexWrapper<TKey>>()
  private resolvedIndexes = new Map<number, BaseIndex<TKey>>()
  private isIndexesResolved = false
  private indexCounter = 0

  // Event system
  private changeListeners = new Set<ChangeListener<T, TKey>>()
  private changeKeyListeners = new Map<TKey, Set<ChangeListener<T, TKey>>>()

  // Utilities namespace
  // This is populated by createCollection
  public utils: Record<string, Fn> = {}

  // State used for computing the change events
  private syncedKeys = new Set<TKey>()
  private preSyncVisibleState = new Map<TKey, T>()
  private recentlySyncedKeys = new Set<TKey>()
  private hasReceivedFirstCommit = false
  private isCommittingSyncTransactions = false

  // Array to store one-time ready listeners
  private onFirstReadyCallbacks: Array<() => void> = []
  private hasBeenReady = false

  // Event batching for preventing duplicate emissions during transaction flows
  private batchedEvents: Array<ChangeMessage<T, TKey>> = []
  private shouldBatchEvents = false

  // Lifecycle management
  private _status: CollectionStatus = `idle`
  private activeSubscribersCount = 0
  private gcTimeoutId: ReturnType<typeof setTimeout> | null = null
  private preloadPromise: Promise<void> | null = null
  private syncCleanupFn: (() => void) | null = null

  /**
   * Register a callback to be executed when the collection first becomes ready
   * Useful for preloading collections
   * @param callback Function to call when the collection first becomes ready
   * @example
   * collection.onFirstReady(() => {
   *   console.log('Collection is ready for the first time')
   *   // Safe to access collection.state now
   * })
   */
  public onFirstReady(callback: () => void): void {
    // If already ready, call immediately
    if (this.hasBeenReady) {
      callback()
      return
    }

    this.onFirstReadyCallbacks.push(callback)
  }

  /**
   * Check if the collection is ready for use
   * Returns true if the collection has been marked as ready by its sync implementation
   * @returns true if the collection is ready, false otherwise
   * @example
   * if (collection.isReady()) {
   *   console.log('Collection is ready, data is available')
   *   // Safe to access collection.state
   * } else {
   *   console.log('Collection is still loading')
   * }
   */
  public isReady(): boolean {
    return this._status === `ready`
  }

  /**
   * Mark the collection as ready for use
   * This is called by sync implementations to explicitly signal that the collection is ready,
   * providing a more intuitive alternative to using commits for readiness signaling
   * @private - Should only be called by sync implementations
   */
  private markReady(): void {
    // Can transition to ready from loading or initialCommit states
    if (this._status === `loading` || this._status === `initialCommit`) {
      this.setStatus(`ready`)

      // Call any registered first ready callbacks (only on first time becoming ready)
      if (!this.hasBeenReady) {
        this.hasBeenReady = true

        // Also mark as having received first commit for backwards compatibility
        if (!this.hasReceivedFirstCommit) {
          this.hasReceivedFirstCommit = true
        }

        const callbacks = [...this.onFirstReadyCallbacks]
        this.onFirstReadyCallbacks = []
        callbacks.forEach((callback) => callback())

        // If the collection is empty when it becomes ready, emit an empty change event
        // to notify subscribers (like LiveQueryCollection) that the collection is ready
        if (this.size === 0 && this.changeListeners.size > 0) {
          this.emitEmptyReadyEvent()
        }
      }
    }
  }

  public id = ``

  /**
   * Gets the current status of the collection
   */
  public get status(): CollectionStatus {
    return this._status
  }

  /**
   * Validates that the collection is in a usable state for data operations
   * @private
   */
  private validateCollectionUsable(operation: string): void {
    switch (this._status) {
      case `error`:
        throw new CollectionInErrorStateError(operation, this.id)
      case `cleaned-up`:
        // Automatically restart the collection when operations are called on cleaned-up collections
        this.startSync()
        break
    }
  }

  /**
   * Validates state transitions to prevent invalid status changes
   * @private
   */
  private validateStatusTransition(
    from: CollectionStatus,
    to: CollectionStatus
  ): void {
    if (from === to) {
      // Allow same state transitions
      return
    }
    const validTransitions: Record<
      CollectionStatus,
      Array<CollectionStatus>
    > = {
      idle: [`loading`, `error`, `cleaned-up`],
      loading: [`initialCommit`, `ready`, `error`, `cleaned-up`],
      initialCommit: [`ready`, `error`, `cleaned-up`],
      ready: [`cleaned-up`, `error`],
      error: [`cleaned-up`, `idle`],
      "cleaned-up": [`loading`, `error`],
    }

    if (!validTransitions[from].includes(to)) {
      throw new InvalidCollectionStatusTransitionError(from, to, this.id)
    }
  }

  /**
   * Safely update the collection status with validation
   * @private
   */
  private setStatus(newStatus: CollectionStatus): void {
    this.validateStatusTransition(this._status, newStatus)
    this._status = newStatus

    // Resolve indexes when collection becomes ready
    if (newStatus === `ready` && !this.isIndexesResolved) {
      // Resolve indexes asynchronously without blocking
      this.resolveAllIndexes().catch((error) => {
        console.warn(`Failed to resolve indexes:`, error)
      })
    }
  }

  /**
   * Creates a new Collection instance
   *
   * @param config - Configuration object for the collection
   * @throws Error if sync config is missing
   */
  constructor(config: CollectionConfig<T, TKey, TSchema, TInsertInput>) {
    // eslint-disable-next-line
    if (!config) {
      throw new CollectionRequiresConfigError()
    }
    if (config.id) {
      this.id = config.id
    } else {
      this.id = crypto.randomUUID()
    }

    // eslint-disable-next-line
    if (!config.sync) {
      throw new CollectionRequiresSyncConfigError()
    }

    this.transactions = new SortedMap<string, Transaction<any>>((a, b) =>
      a.compareCreatedAt(b)
    )

    // Set default values for optional config properties
    this.config = {
      ...config,
      autoIndex: config.autoIndex ?? `eager`,
    }

    // Set up data storage with optional comparison function
    if (this.config.compare) {
      this.syncedData = new SortedMap<TKey, T>(this.config.compare)
    } else {
      this.syncedData = new Map<TKey, T>()
    }

    // Only start sync immediately if explicitly enabled
    if (config.startSync === true) {
      this.startSync()
    }
  }

  /**
   * Start sync immediately - internal method for compiled queries
   * This bypasses lazy loading for special cases like live query results
   */
  public startSyncImmediate(): void {
    this.startSync()
  }

  /**
   * Start the sync process for this collection
   * This is called when the collection is first accessed or preloaded
   */
  private startSync(): void {
    if (this._status !== `idle` && this._status !== `cleaned-up`) {
      return // Already started or in progress
    }

    this.setStatus(`loading`)

    try {
      const cleanupFn = this.config.sync.sync({
        collection: this,
        begin: () => {
          this.pendingSyncedTransactions.push({
            committed: false,
            operations: [],
          })
        },
        write: (messageWithoutKey: Omit<ChangeMessage<T>, `key`>) => {
          const pendingTransaction =
            this.pendingSyncedTransactions[
              this.pendingSyncedTransactions.length - 1
            ]
          if (!pendingTransaction) {
            throw new NoPendingSyncTransactionWriteError()
          }
          if (pendingTransaction.committed) {
            throw new SyncTransactionAlreadyCommittedWriteError()
          }
          const key = this.getKeyFromItem(messageWithoutKey.value)

          // Check if an item with this key already exists when inserting
          if (messageWithoutKey.type === `insert`) {
            if (
              this.syncedData.has(key) &&
              !pendingTransaction.operations.some(
                (op) => op.key === key && op.type === `delete`
              )
            ) {
              throw new DuplicateKeySyncError(key, this.id)
            }
          }

          const message: ChangeMessage<T> = {
            ...messageWithoutKey,
            key,
          }
          pendingTransaction.operations.push(message)
        },
        commit: () => {
          const pendingTransaction =
            this.pendingSyncedTransactions[
              this.pendingSyncedTransactions.length - 1
            ]
          if (!pendingTransaction) {
            throw new NoPendingSyncTransactionCommitError()
          }
          if (pendingTransaction.committed) {
            throw new SyncTransactionAlreadyCommittedError()
          }

          pendingTransaction.committed = true

          // Update status to initialCommit when transitioning from loading
          // This indicates we're in the process of committing the first transaction
          if (this._status === `loading`) {
            this.setStatus(`initialCommit`)
          }

          this.commitPendingTransactions()
        },
        markReady: () => {
          this.markReady()
        },
      })

      // Store cleanup function if provided
      this.syncCleanupFn = typeof cleanupFn === `function` ? cleanupFn : null
    } catch (error) {
      this.setStatus(`error`)
      throw error
    }
  }

  /**
   * Preload the collection data by starting sync if not already started
   * Multiple concurrent calls will share the same promise
   */
  public preload(): Promise<void> {
    if (this.preloadPromise) {
      return this.preloadPromise
    }

    this.preloadPromise = new Promise<void>((resolve, reject) => {
      if (this._status === `ready`) {
        resolve()
        return
      }

      if (this._status === `error`) {
        reject(new CollectionIsInErrorStateError())
        return
      }

      // Register callback BEFORE starting sync to avoid race condition
      this.onFirstReady(() => {
        resolve()
      })

      // Start sync if collection hasn't started yet or was cleaned up
      if (this._status === `idle` || this._status === `cleaned-up`) {
        try {
          this.startSync()
        } catch (error) {
          reject(error)
          return
        }
      }
    })

    return this.preloadPromise
  }

  /**
   * Clean up the collection by stopping sync and clearing data
   * This can be called manually or automatically by garbage collection
   */
  public async cleanup(): Promise<void> {
    // Clear GC timeout
    if (this.gcTimeoutId) {
      clearTimeout(this.gcTimeoutId)
      this.gcTimeoutId = null
    }

    // Stop sync - wrap in try/catch since it's user-provided code
    try {
      if (this.syncCleanupFn) {
        this.syncCleanupFn()
        this.syncCleanupFn = null
      }
    } catch (error) {
      // Re-throw in a microtask to surface the error after cleanup completes
      queueMicrotask(() => {
        if (error instanceof Error) {
          // Preserve the original error and stack trace
          const wrappedError = new SyncCleanupError(this.id, error)
          wrappedError.cause = error
          wrappedError.stack = error.stack
          throw wrappedError
        } else {
          throw new SyncCleanupError(this.id, error as Error | string)
        }
      })
    }

    // Clear data
    this.syncedData.clear()
    this.syncedMetadata.clear()
    this.optimisticUpserts.clear()
    this.optimisticDeletes.clear()
    this._size = 0
    this.pendingSyncedTransactions = []
    this.syncedKeys.clear()
    this.hasReceivedFirstCommit = false
    this.hasBeenReady = false
    this.onFirstReadyCallbacks = []
    this.preloadPromise = null
    this.batchedEvents = []
    this.shouldBatchEvents = false

    // Update status
    this.setStatus(`cleaned-up`)

    return Promise.resolve()
  }

  /**
   * Start the garbage collection timer
   * Called when the collection becomes inactive (no subscribers)
   */
  private startGCTimer(): void {
    if (this.gcTimeoutId) {
      clearTimeout(this.gcTimeoutId)
    }

    const gcTime = this.config.gcTime ?? 300000 // 5 minutes default
    this.gcTimeoutId = setTimeout(() => {
      if (this.activeSubscribersCount === 0) {
        this.cleanup()
      }
    }, gcTime)
  }

  /**
   * Cancel the garbage collection timer
   * Called when the collection becomes active again
   */
  private cancelGCTimer(): void {
    if (this.gcTimeoutId) {
      clearTimeout(this.gcTimeoutId)
      this.gcTimeoutId = null
    }
  }

  /**
   * Increment the active subscribers count and start sync if needed
   */
  private addSubscriber(): void {
    this.activeSubscribersCount++
    this.cancelGCTimer()

    // Start sync if collection was cleaned up
    if (this._status === `cleaned-up` || this._status === `idle`) {
      this.startSync()
    }
  }

  /**
   * Decrement the active subscribers count and start GC timer if needed
   */
  private removeSubscriber(): void {
    this.activeSubscribersCount--

    if (this.activeSubscribersCount === 0) {
      this.activeSubscribersCount = 0
      this.startGCTimer()
    } else if (this.activeSubscribersCount < 0) {
      throw new NegativeActiveSubscribersError()
    }
  }

  /**
   * Recompute optimistic state from active transactions
   */
  private recomputeOptimisticState(
    triggeredByUserAction: boolean = false
  ): void {
    // Skip redundant recalculations when we're in the middle of committing sync transactions
    if (this.isCommittingSyncTransactions) {
      return
    }

    const previousState = new Map(this.optimisticUpserts)
    const previousDeletes = new Set(this.optimisticDeletes)

    // Clear current optimistic state
    this.optimisticUpserts.clear()
    this.optimisticDeletes.clear()

    const activeTransactions: Array<Transaction<any>> = []

    for (const transaction of this.transactions.values()) {
      if (![`completed`, `failed`].includes(transaction.state)) {
        activeTransactions.push(transaction)
      }
    }

    // Apply active transactions only (completed transactions are handled by sync operations)
    for (const transaction of activeTransactions) {
      for (const mutation of transaction.mutations) {
        if (mutation.collection === this && mutation.optimistic) {
          switch (mutation.type) {
            case `insert`:
            case `update`:
              this.optimisticUpserts.set(mutation.key, mutation.modified as T)
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
    this._size = this.calculateSize()

    // Collect events for changes
    const events: Array<ChangeMessage<T, TKey>> = []
    this.collectOptimisticChanges(previousState, previousDeletes, events)

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
      const pendingSyncKeys = new Set<TKey>()

      // Collect keys from pending sync operations
      for (const transaction of this.pendingSyncedTransactions) {
        for (const operation of transaction.operations) {
          pendingSyncKeys.add(operation.key as TKey)
        }
      }

      // Only filter out delete events for keys that:
      // 1. Have pending sync operations AND
      // 2. Are from completed transactions (being cleaned up)
      const filteredEvents = filteredEventsBySyncStatus.filter((event) => {
        if (event.type === `delete` && pendingSyncKeys.has(event.key)) {
          // Check if this delete is from clearing optimistic state of completed transactions
          // We can infer this by checking if we have no remaining optimistic mutations for this key
          const hasActiveOptimisticMutation = activeTransactions.some((tx) =>
            tx.mutations.some(
              (m) => m.collection === this && m.key === event.key
            )
          )

          if (!hasActiveOptimisticMutation) {
            return false // Skip this delete event as sync will restore the data
          }
        }
        return true
      })

      // Update indexes for the filtered events
      if (filteredEvents.length > 0) {
        this.updateIndexes(filteredEvents)
      }
      this.emitEvents(filteredEvents, triggeredByUserAction)
    } else {
      // Update indexes for all events
      if (filteredEventsBySyncStatus.length > 0) {
        this.updateIndexes(filteredEventsBySyncStatus)
      }
      // Emit all events if no pending sync transactions
      this.emitEvents(filteredEventsBySyncStatus, triggeredByUserAction)
    }
  }

  /**
   * Calculate the current size based on synced data and optimistic changes
   */
  private calculateSize(): number {
    const syncedSize = this.syncedData.size
    const deletesFromSynced = Array.from(this.optimisticDeletes).filter(
      (key) => this.syncedData.has(key) && !this.optimisticUpserts.has(key)
    ).length
    const upsertsNotInSynced = Array.from(this.optimisticUpserts.keys()).filter(
      (key) => !this.syncedData.has(key)
    ).length

    return syncedSize - deletesFromSynced + upsertsNotInSynced
  }

  /**
   * Collect events for optimistic changes
   */
  private collectOptimisticChanges(
    previousUpserts: Map<TKey, T>,
    previousDeletes: Set<TKey>,
    events: Array<ChangeMessage<T, TKey>>
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
        previousDeletes
      )

      if (previousValue !== undefined && currentValue === undefined) {
        events.push({ type: `delete`, key, value: previousValue })
      } else if (previousValue === undefined && currentValue !== undefined) {
        events.push({ type: `insert`, key, value: currentValue })
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
        })
      }
    }
  }

  /**
   * Get the previous value for a key given previous optimistic state
   */
  private getPreviousValue(
    key: TKey,
    previousUpserts: Map<TKey, T>,
    previousDeletes: Set<TKey>
  ): T | undefined {
    if (previousDeletes.has(key)) {
      return undefined
    }
    if (previousUpserts.has(key)) {
      return previousUpserts.get(key)
    }
    return this.syncedData.get(key)
  }

  /**
   * Emit an empty ready event to notify subscribers that the collection is ready
   * This bypasses the normal empty array check in emitEvents
   */
  private emitEmptyReadyEvent(): void {
    // Emit empty array directly to all listeners
    for (const listener of this.changeListeners) {
      listener([])
    }
  }

  /**
   * Emit events either immediately or batch them for later emission
   */
  private emitEvents(
    changes: Array<ChangeMessage<T, TKey>>,
    forceEmit = false
  ): void {
    // Skip batching for user actions (forceEmit=true) to keep UI responsive
    if (this.shouldBatchEvents && !forceEmit) {
      // Add events to the batch
      this.batchedEvents.push(...changes)
      return
    }

    // Either we're not batching, or we're forcing emission (user action or ending batch cycle)
    let eventsToEmit = changes

    // If we have batched events and this is a forced emit, combine them
    if (this.batchedEvents.length > 0 && forceEmit) {
      eventsToEmit = [...this.batchedEvents, ...changes]
      this.batchedEvents = []
      this.shouldBatchEvents = false
    }

    if (eventsToEmit.length === 0) return

    // Emit to all listeners
    for (const listener of this.changeListeners) {
      listener(eventsToEmit)
    }

    // Emit to key-specific listeners
    if (this.changeKeyListeners.size > 0) {
      // Group changes by key, but only for keys that have listeners
      const changesByKey = new Map<TKey, Array<ChangeMessage<T, TKey>>>()
      for (const change of eventsToEmit) {
        if (this.changeKeyListeners.has(change.key)) {
          if (!changesByKey.has(change.key)) {
            changesByKey.set(change.key, [])
          }
          changesByKey.get(change.key)!.push(change)
        }
      }

      // Emit batched changes to each key's listeners
      for (const [key, keyChanges] of changesByKey) {
        const keyListeners = this.changeKeyListeners.get(key)!
        for (const listener of keyListeners) {
          listener(keyChanges)
        }
      }
    }
  }

  /**
   * Get the current value for a key (virtual derived state)
   */
  public get(key: TKey): T | undefined {
    // Check if optimistically deleted
    if (this.optimisticDeletes.has(key)) {
      return undefined
    }

    // Check optimistic upserts first
    if (this.optimisticUpserts.has(key)) {
      return this.optimisticUpserts.get(key)
    }

    // Fall back to synced data
    return this.syncedData.get(key)
  }

  /**
   * Check if a key exists in the collection (virtual derived state)
   */
  public has(key: TKey): boolean {
    // Check if optimistically deleted
    if (this.optimisticDeletes.has(key)) {
      return false
    }

    // Check optimistic upserts first
    if (this.optimisticUpserts.has(key)) {
      return true
    }

    // Fall back to synced data
    return this.syncedData.has(key)
  }

  /**
   * Get the current size of the collection (cached)
   */
  public get size(): number {
    return this._size
  }

  /**
   * Get all keys (virtual derived state)
   */
  public *keys(): IterableIterator<TKey> {
    // Yield keys from synced data, skipping any that are deleted.
    for (const key of this.syncedData.keys()) {
      if (!this.optimisticDeletes.has(key)) {
        yield key
      }
    }
    // Yield keys from upserts that were not already in synced data.
    for (const key of this.optimisticUpserts.keys()) {
      if (!this.syncedData.has(key) && !this.optimisticDeletes.has(key)) {
        // The optimisticDeletes check is technically redundant if inserts/updates always remove from deletes,
        // but it's safer to keep it.
        yield key
      }
    }
  }

  /**
   * Get all values (virtual derived state)
   */
  public *values(): IterableIterator<T> {
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
  public *entries(): IterableIterator<[TKey, T]> {
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
  public *[Symbol.iterator](): IterableIterator<[TKey, T]> {
    for (const [key, value] of this.entries()) {
      yield [key, value]
    }
  }

  /**
   * Execute a callback for each entry in the collection
   */
  public forEach(
    callbackfn: (value: T, key: TKey, index: number) => void
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
    callbackfn: (value: T, key: TKey, index: number) => U
  ): Array<U> {
    const result: Array<U> = []
    let index = 0
    for (const [key, value] of this.entries()) {
      result.push(callbackfn(value, key, index++))
    }
    return result
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

    if (!hasPersistingTransaction) {
      // Set flag to prevent redundant optimistic state recalculations
      this.isCommittingSyncTransactions = true

      // First collect all keys that will be affected by sync operations
      const changedKeys = new Set<TKey>()
      for (const transaction of this.pendingSyncedTransactions) {
        for (const operation of transaction.operations) {
          changedKeys.add(operation.key as TKey)
        }
      }

      // Use pre-captured state if available (from optimistic scenarios),
      // otherwise capture current state (for pure sync scenarios)
      let currentVisibleState = this.preSyncVisibleState
      if (currentVisibleState.size === 0) {
        // No pre-captured state, capture it now for pure sync operations
        currentVisibleState = new Map<TKey, T>()
        for (const key of changedKeys) {
          const currentValue = this.get(key)
          if (currentValue !== undefined) {
            currentVisibleState.set(key, currentValue)
          }
        }
      }

      const events: Array<ChangeMessage<T, TKey>> = []
      const rowUpdateMode = this.config.sync.rowUpdateMode || `partial`

      for (const transaction of this.pendingSyncedTransactions) {
        for (const operation of transaction.operations) {
          const key = operation.key as TKey
          this.syncedKeys.add(key)

          // Update metadata
          switch (operation.type) {
            case `insert`:
              this.syncedMetadata.set(key, operation.metadata)
              break
            case `update`:
              this.syncedMetadata.set(
                key,
                Object.assign(
                  {},
                  this.syncedMetadata.get(key),
                  operation.metadata
                )
              )
              break
            case `delete`:
              this.syncedMetadata.delete(key)
              break
          }

          // Update synced data
          switch (operation.type) {
            case `insert`:
              this.syncedData.set(key, operation.value)
              break
            case `update`: {
              if (rowUpdateMode === `partial`) {
                const updatedValue = Object.assign(
                  {},
                  this.syncedData.get(key),
                  operation.value
                )
                this.syncedData.set(key, updatedValue)
              } else {
                this.syncedData.set(key, operation.value)
              }
              break
            }
            case `delete`:
              this.syncedData.delete(key)
              break
          }
        }
      }

      // Clear optimistic state since sync operations will now provide the authoritative data
      this.optimisticUpserts.clear()
      this.optimisticDeletes.clear()

      // Reset flag and recompute optimistic state for any remaining active transactions
      this.isCommittingSyncTransactions = false
      for (const transaction of this.transactions.values()) {
        if (![`completed`, `failed`].includes(transaction.state)) {
          for (const mutation of transaction.mutations) {
            if (mutation.collection === this && mutation.optimistic) {
              switch (mutation.type) {
                case `insert`:
                case `update`:
                  this.optimisticUpserts.set(
                    mutation.key,
                    mutation.modified as T
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

      // Check for redundant sync operations that match completed optimistic operations
      const completedOptimisticOps = new Map<TKey, any>()

      for (const transaction of this.transactions.values()) {
        if (transaction.state === `completed`) {
          for (const mutation of transaction.mutations) {
            if (mutation.collection === this && changedKeys.has(mutation.key)) {
              completedOptimisticOps.set(mutation.key, {
                type: mutation.type,
                value: mutation.modified,
              })
            }
          }
        }
      }

      // Now check what actually changed in the final visible state
      for (const key of changedKeys) {
        const previousVisibleValue = currentVisibleState.get(key)
        const newVisibleValue = this.get(key) // This returns the new derived state

        // Check if this sync operation is redundant with a completed optimistic operation
        const completedOp = completedOptimisticOps.get(key)
        const isRedundantSync =
          completedOp &&
          newVisibleValue !== undefined &&
          this.deepEqual(completedOp.value, newVisibleValue)

        if (!isRedundantSync) {
          if (
            previousVisibleValue === undefined &&
            newVisibleValue !== undefined
          ) {
            events.push({
              type: `insert`,
              key,
              value: newVisibleValue,
            })
          } else if (
            previousVisibleValue !== undefined &&
            newVisibleValue === undefined
          ) {
            events.push({
              type: `delete`,
              key,
              value: previousVisibleValue,
            })
          } else if (
            previousVisibleValue !== undefined &&
            newVisibleValue !== undefined &&
            !this.deepEqual(previousVisibleValue, newVisibleValue)
          ) {
            events.push({
              type: `update`,
              key,
              value: newVisibleValue,
              previousValue: previousVisibleValue,
            })
          }
        }
      }

      // Update cached size after synced data changes
      this._size = this.calculateSize()

      // Update indexes for all events before emitting
      if (events.length > 0) {
        this.updateIndexes(events)
      }

      // End batching and emit all events (combines any batched events with sync events)
      this.emitEvents(events, true)

      this.pendingSyncedTransactions = []

      // Clear the pre-sync state since sync operations are complete
      this.preSyncVisibleState.clear()

      // Clear recently synced keys after a microtask to allow recomputeOptimisticState to see them
      Promise.resolve().then(() => {
        this.recentlySyncedKeys.clear()
      })

      // Call any registered one-time commit listeners
      if (!this.hasReceivedFirstCommit) {
        this.hasReceivedFirstCommit = true
        const callbacks = [...this.onFirstReadyCallbacks]
        this.onFirstReadyCallbacks = []
        callbacks.forEach((callback) => callback())
      }
    }
  }

  /**
   * Schedule cleanup of a transaction when it completes
   * @private
   */
  private scheduleTransactionCleanup(transaction: Transaction<any>): void {
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
        // This empty catch block is necessary to prevent unhandled promise rejections.
      })
  }

  private ensureStandardSchema(schema: unknown): StandardSchema<T> {
    // If the schema already implements the standard-schema interface, return it
    if (schema && `~standard` in (schema as {})) {
      return schema as StandardSchema<T>
    }

    throw new InvalidSchemaError()
  }

  public getKeyFromItem(item: T): TKey {
    return this.config.getKey(item)
  }

  public generateGlobalKey(key: any, item: any): string {
    if (typeof key === `undefined`) {
      throw new UndefinedKeyError(item)
    }

    return `KEY::${this.id}/${key}`
  }

  /**
   * Creates an index on a collection for faster queries.
   * Indexes significantly improve query performance by allowing binary search
   * and range queries instead of full scans.
   *
   * @template TResolver - The type of the index resolver (constructor or async loader)
   * @param indexCallback - Function that extracts the indexed value from each item
   * @param config - Configuration including index type and type-specific options
   * @returns An index proxy that provides access to the index when ready
   *
   * @example
   * // Create a default B+ tree index
   * const ageIndex = collection.createIndex((row) => row.age)
   *
   * // Create a ordered index with custom options
   * const ageIndex = collection.createIndex((row) => row.age, {
   *   indexType: BTreeIndex,
   *   options: { compareFn: customComparator },
   *   name: 'age_btree'
   * })
   *
   * // Create an async-loaded index
   * const textIndex = collection.createIndex((row) => row.content, {
   *   indexType: async () => {
   *     const { FullTextIndex } = await import('./indexes/fulltext.js')
   *     return FullTextIndex
   *   },
   *   options: { language: 'en' }
   * })
   */
  public createIndex<TResolver extends IndexResolver<TKey> = typeof BTreeIndex>(
    indexCallback: (row: SingleRowRefProxy<T>) => any,
    config: IndexOptions<TResolver> = {}
  ): IndexProxy<TKey> {
    this.validateCollectionUsable(`createIndex`)

    const indexId = ++this.indexCounter
    const singleRowRefProxy = createSingleRowRefProxy<T>()
    const indexExpression = indexCallback(singleRowRefProxy)
    const expression = toExpression(indexExpression)

    // Default to BTreeIndex if no type specified
    const resolver = config.indexType ?? (BTreeIndex as unknown as TResolver)

    // Create lazy wrapper
    const lazyIndex = new LazyIndexWrapper<TKey>(
      indexId,
      expression,
      config.name,
      resolver,
      config.options,
      this.entries()
    )

    this.lazyIndexes.set(indexId, lazyIndex)

    // For BTreeIndex, resolve immediately and synchronously
    if ((resolver as unknown) === BTreeIndex) {
      try {
        const resolvedIndex = lazyIndex.getResolved()
        this.resolvedIndexes.set(indexId, resolvedIndex)
      } catch (error) {
        console.warn(`Failed to resolve BTreeIndex:`, error)
      }
    } else if (typeof resolver === `function` && resolver.prototype) {
      // Other synchronous constructors - resolve immediately
      try {
        const resolvedIndex = lazyIndex.getResolved()
        this.resolvedIndexes.set(indexId, resolvedIndex)
      } catch {
        // Fallback to async resolution
        this.resolveSingleIndex(indexId, lazyIndex).catch((error) => {
          console.warn(`Failed to resolve single index:`, error)
        })
      }
    } else if (this.isIndexesResolved) {
      // Async loader but indexes are already resolved - resolve this one
      this.resolveSingleIndex(indexId, lazyIndex).catch((error) => {
        console.warn(`Failed to resolve single index:`, error)
      })
    }

    return new IndexProxy(indexId, lazyIndex)
  }

  /**
   * Resolve all lazy indexes (called when collection first syncs)
   * @private
   */
  private async resolveAllIndexes(): Promise<void> {
    if (this.isIndexesResolved) return

    const resolutionPromises = Array.from(this.lazyIndexes.entries()).map(
      async ([indexId, lazyIndex]) => {
        const resolvedIndex = await lazyIndex.resolve()

        // Build index with current data
        resolvedIndex.build(this.entries())

        this.resolvedIndexes.set(indexId, resolvedIndex)
        return { indexId, resolvedIndex }
      }
    )

    await Promise.all(resolutionPromises)
    this.isIndexesResolved = true
  }

  /**
   * Resolve a single index immediately
   * @private
   */
  private async resolveSingleIndex(
    indexId: number,
    lazyIndex: LazyIndexWrapper<TKey>
  ): Promise<BaseIndex<TKey>> {
    const resolvedIndex = await lazyIndex.resolve()
    resolvedIndex.build(this.entries())
    this.resolvedIndexes.set(indexId, resolvedIndex)
    return resolvedIndex
  }

  /**
   * Get resolved indexes for query optimization
   */
  get indexes(): Map<number, BaseIndex<TKey>> {
    return this.resolvedIndexes
  }

  /**
   * Updates all indexes when the collection changes
   * @private
   */
  private updateIndexes(changes: Array<ChangeMessage<T, TKey>>): void {
    for (const index of this.resolvedIndexes.values()) {
      for (const change of changes) {
        switch (change.type) {
          case `insert`:
            index.add(change.key, change.value)
            break
          case `update`:
            if (change.previousValue) {
              index.update(change.key, change.previousValue, change.value)
            } else {
              index.add(change.key, change.value)
            }
            break
          case `delete`:
            index.remove(change.key, change.value)
            break
        }
      }
    }
  }

  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true
    if (a == null || b == null) return false
    if (typeof a !== typeof b) return false

    if (typeof a === `object`) {
      if (Array.isArray(a) !== Array.isArray(b)) return false

      const keysA = Object.keys(a)
      const keysB = Object.keys(b)
      if (keysA.length !== keysB.length) return false

      const keysBSet = new Set(keysB)
      for (const key of keysA) {
        if (!keysBSet.has(key)) return false
        if (!this.deepEqual(a[key], b[key])) return false
      }
      return true
    }

    return false
  }

  public validateData(
    data: unknown,
    type: `insert` | `update`,
    key?: TKey
  ): T | never {
    if (!this.config.schema) return data as T

    const standardSchema = this.ensureStandardSchema(this.config.schema)

    // For updates, we need to merge with the existing data before validation
    if (type === `update` && key) {
      // Get the existing data for this key
      const existingData = this.get(key)

      if (
        existingData &&
        data &&
        typeof data === `object` &&
        typeof existingData === `object`
      ) {
        // Merge the update with the existing data
        const mergedData = Object.assign({}, existingData, data)

        // Validate the merged data
        const result = standardSchema[`~standard`].validate(mergedData)

        // Ensure validation is synchronous
        if (result instanceof Promise) {
          throw new SchemaMustBeSynchronousError()
        }

        // If validation fails, throw a SchemaValidationError with the issues
        if (`issues` in result && result.issues) {
          const typedIssues = result.issues.map((issue) => ({
            message: issue.message,
            path: issue.path?.map((p) => String(p)),
          }))
          throw new SchemaValidationError(type, typedIssues)
        }

        // Return the original update data, not the merged data
        // We only used the merged data for validation
        return data as T
      }
    }

    // For inserts or updates without existing data, validate the data directly
    const result = standardSchema[`~standard`].validate(data)

    // Ensure validation is synchronous
    if (result instanceof Promise) {
      throw new SchemaMustBeSynchronousError()
    }

    // If validation fails, throw a SchemaValidationError with the issues
    if (`issues` in result && result.issues) {
      const typedIssues = result.issues.map((issue) => ({
        message: issue.message,
        path: issue.path?.map((p) => String(p)),
      }))
      throw new SchemaValidationError(type, typedIssues)
    }

    return result.value as T
  }

  /**
   * Inserts one or more items into the collection
   * @param items - Single item or array of items to insert
   * @param config - Optional configuration including metadata
   * @returns A Transaction object representing the insert operation(s)
   * @throws {SchemaValidationError} If the data fails schema validation
   * @example
   * // Insert a single todo (requires onInsert handler)
   * const tx = collection.insert({ id: "1", text: "Buy milk", completed: false })
   * await tx.isPersisted.promise
   *
   * @example
   * // Insert multiple todos at once
   * const tx = collection.insert([
   *   { id: "1", text: "Buy milk", completed: false },
   *   { id: "2", text: "Walk dog", completed: true }
   * ])
   * await tx.isPersisted.promise
   *
   * @example
   * // Insert with metadata
   * const tx = collection.insert({ id: "1", text: "Buy groceries" },
   *   { metadata: { source: "mobile-app" } }
   * )
   * await tx.isPersisted.promise
   *
   * @example
   * // Handle errors
   * try {
   *   const tx = collection.insert({ id: "1", text: "New item" })
   *   await tx.isPersisted.promise
   *   console.log('Insert successful')
   * } catch (error) {
   *   console.log('Insert failed:', error)
   * }
   */
  insert = (
    data: TInsertInput | Array<TInsertInput>,
    config?: InsertConfig
  ) => {
    this.validateCollectionUsable(`insert`)
    const ambientTransaction = getActiveTransaction()

    // If no ambient transaction exists, check for an onInsert handler early
    if (!ambientTransaction && !this.config.onInsert) {
      throw new MissingInsertHandlerError()
    }

    const items = Array.isArray(data) ? data : [data]
    const mutations: Array<PendingMutation<T>> = []

    // Create mutations for each item
    items.forEach((item) => {
      // Validate the data against the schema if one exists
      const validatedData = this.validateData(item, `insert`)

      // Check if an item with this ID already exists in the collection
      const key = this.getKeyFromItem(validatedData)
      if (this.has(key)) {
        throw new DuplicateKeyError(key)
      }
      const globalKey = this.generateGlobalKey(key, item)

      const mutation: PendingMutation<T, `insert`> = {
        mutationId: crypto.randomUUID(),
        original: {},
        modified: validatedData,
        // Pick the values from validatedData based on what's passed in - this is for cases
        // where a schema has default values. The validated data has the extra default
        // values but for changes, we just want to show the data that was actually passed in.
        changes: Object.fromEntries(
          Object.keys(item).map((k) => [
            k,
            validatedData[k as keyof typeof validatedData],
          ])
        ) as TInsertInput,
        globalKey,
        key,
        metadata: config?.metadata as unknown,
        syncMetadata: this.config.sync.getSyncMetadata?.() || {},
        optimistic: config?.optimistic ?? true,
        type: `insert`,
        createdAt: new Date(),
        updatedAt: new Date(),
        collection: this,
      }

      mutations.push(mutation)
    })

    // If an ambient transaction exists, use it
    if (ambientTransaction) {
      ambientTransaction.applyMutations(mutations)

      this.transactions.set(ambientTransaction.id, ambientTransaction)
      this.scheduleTransactionCleanup(ambientTransaction)
      this.recomputeOptimisticState(true)

      return ambientTransaction
    } else {
      // Create a new transaction with a mutation function that calls the onInsert handler
      const directOpTransaction = createTransaction<T>({
        mutationFn: async (params) => {
          // Call the onInsert handler with the transaction and collection
          return await this.config.onInsert!({
            transaction:
              params.transaction as unknown as TransactionWithMutations<
                TInsertInput,
                `insert`
              >,
            collection: this as unknown as Collection<T, TKey, TUtils>,
          })
        },
      })

      // Apply mutations to the new transaction
      directOpTransaction.applyMutations(mutations)
      directOpTransaction.commit()

      // Add the transaction to the collection's transactions store
      this.transactions.set(directOpTransaction.id, directOpTransaction)
      this.scheduleTransactionCleanup(directOpTransaction)
      this.recomputeOptimisticState(true)

      return directOpTransaction
    }
  }

  /**
   * Updates one or more items in the collection using a callback function
   * @param keys - Single key or array of keys to update
   * @param configOrCallback - Either update configuration or update callback
   * @param maybeCallback - Update callback if config was provided
   * @returns A Transaction object representing the update operation(s)
   * @throws {SchemaValidationError} If the updated data fails schema validation
   * @example
   * // Update single item by key
   * const tx = collection.update("todo-1", (draft) => {
   *   draft.completed = true
   * })
   * await tx.isPersisted.promise
   *
   * @example
   * // Update multiple items
   * const tx = collection.update(["todo-1", "todo-2"], (drafts) => {
   *   drafts.forEach(draft => { draft.completed = true })
   * })
   * await tx.isPersisted.promise
   *
   * @example
   * // Update with metadata
   * const tx = collection.update("todo-1",
   *   { metadata: { reason: "user update" } },
   *   (draft) => { draft.text = "Updated text" }
   * )
   * await tx.isPersisted.promise
   *
   * @example
   * // Handle errors
   * try {
   *   const tx = collection.update("item-1", draft => { draft.value = "new" })
   *   await tx.isPersisted.promise
   *   console.log('Update successful')
   * } catch (error) {
   *   console.log('Update failed:', error)
   * }
   */

  // Overload 1: Update multiple items with a callback
  update<TItem extends object = T>(
    key: Array<TKey | unknown>,
    callback: (drafts: Array<TItem>) => void
  ): TransactionType

  // Overload 2: Update multiple items with config and a callback
  update<TItem extends object = T>(
    keys: Array<TKey | unknown>,
    config: OperationConfig,
    callback: (drafts: Array<TItem>) => void
  ): TransactionType

  // Overload 3: Update a single item with a callback
  update<TItem extends object = T>(
    id: TKey | unknown,
    callback: (draft: TItem) => void
  ): TransactionType

  // Overload 4: Update a single item with config and a callback
  update<TItem extends object = T>(
    id: TKey | unknown,
    config: OperationConfig,
    callback: (draft: TItem) => void
  ): TransactionType

  update<TItem extends object = T>(
    keys: (TKey | unknown) | Array<TKey | unknown>,
    configOrCallback: ((draft: TItem | Array<TItem>) => void) | OperationConfig,
    maybeCallback?: (draft: TItem | Array<TItem>) => void
  ) {
    if (typeof keys === `undefined`) {
      throw new MissingUpdateArgumentError()
    }

    this.validateCollectionUsable(`update`)

    const ambientTransaction = getActiveTransaction()

    // If no ambient transaction exists, check for an onUpdate handler early
    if (!ambientTransaction && !this.config.onUpdate) {
      throw new MissingUpdateHandlerError()
    }

    const isArray = Array.isArray(keys)
    const keysArray = isArray ? keys : [keys]

    if (isArray && keysArray.length === 0) {
      throw new NoKeysPassedToUpdateError()
    }

    const callback =
      typeof configOrCallback === `function` ? configOrCallback : maybeCallback!
    const config =
      typeof configOrCallback === `function` ? {} : configOrCallback

    // Get the current objects or empty objects if they don't exist
    const currentObjects = keysArray.map((key) => {
      const item = this.get(key)
      if (!item) {
        throw new UpdateKeyNotFoundError(key)
      }

      return item
    }) as unknown as Array<TItem>

    let changesArray
    if (isArray) {
      // Use the proxy to track changes for all objects
      changesArray = withArrayChangeTracking(
        currentObjects,
        callback as (draft: Array<TItem>) => void
      )
    } else {
      const result = withChangeTracking(
        currentObjects[0]!,
        callback as (draft: TItem) => void
      )
      changesArray = [result]
    }

    // Create mutations for each object that has changes
    const mutations: Array<PendingMutation<T, `update`, this>> = keysArray
      .map((key, index) => {
        const itemChanges = changesArray[index] // User-provided changes for this specific item

        // Skip items with no changes
        if (!itemChanges || Object.keys(itemChanges).length === 0) {
          return null
        }

        const originalItem = currentObjects[index] as unknown as T
        // Validate the user-provided changes for this item
        const validatedUpdatePayload = this.validateData(
          itemChanges,
          `update`,
          key
        )

        // Construct the full modified item by applying the validated update payload to the original item
        const modifiedItem = Object.assign(
          {},
          originalItem,
          validatedUpdatePayload
        )

        // Check if the ID of the item is being changed
        const originalItemId = this.getKeyFromItem(originalItem)
        const modifiedItemId = this.getKeyFromItem(modifiedItem)

        if (originalItemId !== modifiedItemId) {
          throw new KeyUpdateNotAllowedError(originalItemId, modifiedItemId)
        }

        const globalKey = this.generateGlobalKey(modifiedItemId, modifiedItem)

        return {
          mutationId: crypto.randomUUID(),
          original: originalItem,
          modified: modifiedItem,
          changes: validatedUpdatePayload as Partial<T>,
          globalKey,
          key,
          metadata: config.metadata as unknown,
          syncMetadata: (this.syncedMetadata.get(key) || {}) as Record<
            string,
            unknown
          >,
          optimistic: config.optimistic ?? true,
          type: `update`,
          createdAt: new Date(),
          updatedAt: new Date(),
          collection: this,
        }
      })
      .filter(Boolean) as Array<PendingMutation<T, `update`, this>>

    // If no changes were made, return an empty transaction early
    if (mutations.length === 0) {
      const emptyTransaction = createTransaction({
        mutationFn: async () => {},
      })
      emptyTransaction.commit()
      // Schedule cleanup for empty transaction
      this.scheduleTransactionCleanup(emptyTransaction)
      return emptyTransaction
    }

    // If an ambient transaction exists, use it
    if (ambientTransaction) {
      ambientTransaction.applyMutations(mutations)

      this.transactions.set(ambientTransaction.id, ambientTransaction)
      this.scheduleTransactionCleanup(ambientTransaction)
      this.recomputeOptimisticState(true)

      return ambientTransaction
    }

    // No need to check for onUpdate handler here as we've already checked at the beginning

    // Create a new transaction with a mutation function that calls the onUpdate handler
    const directOpTransaction = createTransaction<T>({
      mutationFn: async (params) => {
        // Call the onUpdate handler with the transaction and collection
        return this.config.onUpdate!({
          transaction:
            params.transaction as unknown as TransactionWithMutations<
              T,
              `update`
            >,
          collection: this as unknown as Collection<T, TKey, TUtils>,
        })
      },
    })

    // Apply mutations to the new transaction
    directOpTransaction.applyMutations(mutations)
    directOpTransaction.commit()

    // Add the transaction to the collection's transactions store

    this.transactions.set(directOpTransaction.id, directOpTransaction)
    this.scheduleTransactionCleanup(directOpTransaction)
    this.recomputeOptimisticState(true)

    return directOpTransaction
  }

  /**
   * Deletes one or more items from the collection
   * @param keys - Single key or array of keys to delete
   * @param config - Optional configuration including metadata
   * @returns A Transaction object representing the delete operation(s)
   * @example
   * // Delete a single item
   * const tx = collection.delete("todo-1")
   * await tx.isPersisted.promise
   *
   * @example
   * // Delete multiple items
   * const tx = collection.delete(["todo-1", "todo-2"])
   * await tx.isPersisted.promise
   *
   * @example
   * // Delete with metadata
   * const tx = collection.delete("todo-1", { metadata: { reason: "completed" } })
   * await tx.isPersisted.promise
   *
   * @example
   * // Handle errors
   * try {
   *   const tx = collection.delete("item-1")
   *   await tx.isPersisted.promise
   *   console.log('Delete successful')
   * } catch (error) {
   *   console.log('Delete failed:', error)
   * }
   */
  delete = (
    keys: Array<TKey> | TKey,
    config?: OperationConfig
  ): TransactionType<any> => {
    this.validateCollectionUsable(`delete`)

    const ambientTransaction = getActiveTransaction()

    // If no ambient transaction exists, check for an onDelete handler early
    if (!ambientTransaction && !this.config.onDelete) {
      throw new MissingDeleteHandlerError()
    }

    if (Array.isArray(keys) && keys.length === 0) {
      throw new NoKeysPassedToDeleteError()
    }

    const keysArray = Array.isArray(keys) ? keys : [keys]
    const mutations: Array<PendingMutation<T, `delete`, this>> = []

    for (const key of keysArray) {
      if (!this.has(key)) {
        throw new DeleteKeyNotFoundError(key)
      }
      const globalKey = this.generateGlobalKey(key, this.get(key)!)
      const mutation: PendingMutation<T, `delete`, this> = {
        mutationId: crypto.randomUUID(),
        original: this.get(key)!,
        modified: this.get(key)!,
        changes: this.get(key)!,
        globalKey,
        key,
        metadata: config?.metadata as unknown,
        syncMetadata: (this.syncedMetadata.get(key) || {}) as Record<
          string,
          unknown
        >,
        optimistic: config?.optimistic ?? true,
        type: `delete`,
        createdAt: new Date(),
        updatedAt: new Date(),
        collection: this,
      }

      mutations.push(mutation)
    }

    // If an ambient transaction exists, use it
    if (ambientTransaction) {
      ambientTransaction.applyMutations(mutations)

      this.transactions.set(ambientTransaction.id, ambientTransaction)
      this.scheduleTransactionCleanup(ambientTransaction)
      this.recomputeOptimisticState(true)

      return ambientTransaction
    }

    // Create a new transaction with a mutation function that calls the onDelete handler
    const directOpTransaction = createTransaction<T>({
      autoCommit: true,
      mutationFn: async (params) => {
        // Call the onDelete handler with the transaction and collection
        return this.config.onDelete!({
          transaction:
            params.transaction as unknown as TransactionWithMutations<
              T,
              `delete`
            >,
          collection: this as unknown as Collection<T, TKey, TUtils>,
        })
      },
    })

    // Apply mutations to the new transaction
    directOpTransaction.applyMutations(mutations)
    directOpTransaction.commit()

    this.transactions.set(directOpTransaction.id, directOpTransaction)
    this.scheduleTransactionCleanup(directOpTransaction)
    this.recomputeOptimisticState(true)

    return directOpTransaction
  }

  /**
   * Gets the current state of the collection as a Map
   * @returns Map containing all items in the collection, with keys as identifiers
   * @example
   * const itemsMap = collection.state
   * console.log(`Collection has ${itemsMap.size} items`)
   *
   * for (const [key, item] of itemsMap) {
   *   console.log(`${key}: ${item.title}`)
   * }
   *
   * // Check if specific item exists
   * if (itemsMap.has("todo-1")) {
   *   console.log("Todo 1 exists:", itemsMap.get("todo-1"))
   * }
   */
  get state() {
    const result = new Map<TKey, T>()
    for (const [key, value] of this.entries()) {
      result.set(key, value)
    }
    return result
  }

  /**
   * Gets the current state of the collection as a Map, but only resolves when data is available
   * Waits for the first sync commit to complete before resolving
   *
   * @returns Promise that resolves to a Map containing all items in the collection
   */
  stateWhenReady(): Promise<Map<TKey, T>> {
    // If we already have data or collection is ready, resolve immediately
    if (this.size > 0 || this.isReady()) {
      return Promise.resolve(this.state)
    }

    // Otherwise, wait for the collection to be ready
    return new Promise<Map<TKey, T>>((resolve) => {
      this.onFirstReady(() => {
        resolve(this.state)
      })
    })
  }

  /**
   * Gets the current state of the collection as an Array
   *
   * @returns An Array containing all items in the collection
   */
  get toArray() {
    return Array.from(this.values())
  }

  /**
   * Gets the current state of the collection as an Array, but only resolves when data is available
   * Waits for the first sync commit to complete before resolving
   *
   * @returns Promise that resolves to an Array containing all items in the collection
   */
  toArrayWhenReady(): Promise<Array<T>> {
    // If we already have data or collection is ready, resolve immediately
    if (this.size > 0 || this.isReady()) {
      return Promise.resolve(this.toArray)
    }

    // Otherwise, wait for the collection to be ready
    return new Promise<Array<T>>((resolve) => {
      this.onFirstReady(() => {
        resolve(this.toArray)
      })
    })
  }

  /**
   * Returns the current state of the collection as an array of changes
   * @param options - Options including optional where filter
   * @returns An array of changes
   * @example
   * // Get all items as changes
   * const allChanges = collection.currentStateAsChanges()
   *
   * // Get only items matching a condition
   * const activeChanges = collection.currentStateAsChanges({
   *   where: (row) => row.status === 'active'
   * })
   *
   * // Get only items using a pre-compiled expression
   * const activeChanges = collection.currentStateAsChanges({
   *   whereExpression: eq(row.status, 'active')
   * })
   */
  public currentStateAsChanges(
    options: CurrentStateAsChangesOptions<T> = {}
  ): Array<ChangeMessage<T>> {
    return currentStateAsChanges(this, options)
  }

  /**
   * Subscribe to changes in the collection
   * @param callback - Function called when items change
   * @param options - Subscription options including includeInitialState and where filter
   * @returns Unsubscribe function - Call this to stop listening for changes
   * @example
   * // Basic subscription
   * const unsubscribe = collection.subscribeChanges((changes) => {
   *   changes.forEach(change => {
   *     console.log(`${change.type}: ${change.key}`, change.value)
   *   })
   * })
   *
   * // Later: unsubscribe()
   *
   * @example
   * // Include current state immediately
   * const unsubscribe = collection.subscribeChanges((changes) => {
   *   updateUI(changes)
   * }, { includeInitialState: true })
   *
   * @example
   * // Subscribe only to changes matching a condition
   * const unsubscribe = collection.subscribeChanges((changes) => {
   *   updateUI(changes)
   * }, {
   *   includeInitialState: true,
   *   where: (row) => row.status === 'active'
   * })
   *
   * @example
   * // Subscribe using a pre-compiled expression
   * const unsubscribe = collection.subscribeChanges((changes) => {
   *   updateUI(changes)
   * }, {
   *   includeInitialState: true,
   *   whereExpression: eq(row.status, 'active')
   * })
   */
  public subscribeChanges(
    callback: (changes: Array<ChangeMessage<T>>) => void,
    options: SubscribeChangesOptions<T> = {}
  ): () => void {
    // Start sync and track subscriber
    this.addSubscriber()

    // Auto-index for where expressions if enabled
    if (options.whereExpression) {
      ensureIndexForExpression(options.whereExpression, this)
    }

    // Create a filtered callback if where clause is provided
    const filteredCallback =
      options.where || options.whereExpression
        ? createFilteredCallback(callback, options)
        : callback

    if (options.includeInitialState) {
      // First send the current state as changes (filtered if needed)
      const initialChanges = this.currentStateAsChanges({
        where: options.where,
        whereExpression: options.whereExpression,
      })
      filteredCallback(initialChanges)
    }

    // Add to batched listeners
    this.changeListeners.add(filteredCallback)

    return () => {
      this.changeListeners.delete(filteredCallback)
      this.removeSubscriber()
    }
  }

  /**
   * Subscribe to changes for a specific key
   */
  public subscribeChangesKey(
    key: TKey,
    listener: ChangeListener<T, TKey>,
    { includeInitialState = false }: { includeInitialState?: boolean } = {}
  ): () => void {
    // Start sync and track subscriber
    this.addSubscriber()

    if (!this.changeKeyListeners.has(key)) {
      this.changeKeyListeners.set(key, new Set())
    }

    if (includeInitialState) {
      // First send the current state as changes
      listener([
        {
          type: `insert`,
          key,
          value: this.get(key)!,
        },
      ])
    }

    this.changeKeyListeners.get(key)!.add(listener)

    return () => {
      const listeners = this.changeKeyListeners.get(key)
      if (listeners) {
        listeners.delete(listener)
        if (listeners.size === 0) {
          this.changeKeyListeners.delete(key)
        }
      }
      this.removeSubscriber()
    }
  }

  /**
   * Capture visible state for keys that will be affected by pending sync operations
   * This must be called BEFORE onTransactionStateChange clears optimistic state
   */
  private capturePreSyncVisibleState(): void {
    if (this.pendingSyncedTransactions.length === 0) return

    // Clear any previous capture
    this.preSyncVisibleState.clear()

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
    for (const key of syncedKeys) {
      const currentValue = this.get(key)
      if (currentValue !== undefined) {
        this.preSyncVisibleState.set(key, currentValue)
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
    this.shouldBatchEvents = this.pendingSyncedTransactions.length > 0

    // CRITICAL: Capture visible state BEFORE clearing optimistic state
    this.capturePreSyncVisibleState()

    this.recomputeOptimisticState(false)
  }
}
