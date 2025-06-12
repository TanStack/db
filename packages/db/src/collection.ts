import { withArrayChangeTracking, withChangeTracking } from "./proxy"
import { Transaction, getActiveTransaction } from "./transactions"
import { SortedMap } from "./SortedMap"
import type {
  ChangeMessage,
  CollectionConfig,
  InsertConfig,
  OperationConfig,
  OptimisticChangeMessage,
  PendingMutation,
  StandardSchema,
  Transaction as TransactionType,
} from "./types"

// Store collections in memory
export const collectionsStore = new Map<string, Collection<any>>()

// Map to track loading collections
const loadingCollections = new Map<
  string,
  Promise<Collection<Record<string, unknown>>>
>()

interface PendingSyncedTransaction<T extends object = Record<string, unknown>> {
  committed: boolean
  operations: Array<OptimisticChangeMessage<T>>
}

// Event system for collections
type CollectionEventType = `insert` | `update` | `delete`

interface CollectionEvent<T, TKey extends string | number> {
  type: CollectionEventType
  key: TKey
  value: T
  previousValue?: T
}

type EventListener<T, TKey extends string | number> = (
  event: CollectionEvent<T, TKey>
) => void
type KeyListener<T> = (
  value: T | undefined,
  previousValue: T | undefined
) => void

/**
 * Creates a new Collection instance with the given configuration
 *
 * @template T - The type of items in the collection
 * @param config - Configuration for the collection, including id and sync
 * @returns A new Collection instance
 */
export function createCollection<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(config: CollectionConfig<T, TKey>): Collection<T, TKey> {
  return new Collection<T, TKey>(config)
}

/**
 * Preloads a collection with the given configuration
 * Returns a promise that resolves once the sync tool has done its first commit (initial sync is finished)
 * If the collection has already loaded, it resolves immediately
 *
 * This function is useful in route loaders or similar pre-rendering scenarios where you want
 * to ensure data is available before a route transition completes. It uses the same shared collection
 * instance that will be used by useCollection, ensuring data consistency.
 *
 * @example
 * ```typescript
 * // In a route loader
 * async function loader({ params }) {
 *   await preloadCollection({
 *     id: `users-${params.userId}`,
 *     sync: { ... },
 *   });
 *
 *   return null;
 * }
 * ```
 *
 * @template T - The type of items in the collection
 * @param config - Configuration for the collection, including id and sync
 * @returns Promise that resolves when the initial sync is finished
 */
export function preloadCollection<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(config: CollectionConfig<T, TKey>): Promise<Collection<T, TKey>> {
  if (!config.id) {
    throw new Error(`The id property is required for preloadCollection`)
  }

  // If the collection is already fully loaded, return a resolved promise
  if (collectionsStore.has(config.id) && !loadingCollections.has(config.id)) {
    return Promise.resolve(
      collectionsStore.get(config.id)! as unknown as Collection<T, TKey>
    )
  }

  // If the collection is in the process of loading, return its promise
  if (loadingCollections.has(config.id)) {
    return loadingCollections.get(config.id)! as unknown as Promise<
      Collection<T, TKey>
    >
  }

  // Create a new collection instance if it doesn't exist
  if (!collectionsStore.has(config.id)) {
    collectionsStore.set(
      config.id,
      new Collection<T, TKey>({
        id: config.id,
        getKey: config.getKey,
        sync: config.sync,
        schema: config.schema,
      }) as unknown as Collection<any>
    )
  }

  const collection = collectionsStore.get(config.id)! as unknown as Collection<
    T,
    TKey
  >

  // Create a promise that will resolve after the first commit
  let resolveFirstCommit: () => void
  const firstCommitPromise = new Promise<Collection<T, TKey>>((resolve) => {
    resolveFirstCommit = () => {
      resolve(collection)
    }
  })

  // Register a one-time listener for the first commit
  collection.onFirstCommit(() => {
    if (!config.id) {
      throw new Error(`The id property is required for preloadCollection`)
    }
    if (loadingCollections.has(config.id)) {
      loadingCollections.delete(config.id)
      resolveFirstCommit()
    }
  })

  // Store the loading promise
  loadingCollections.set(
    config.id,
    firstCommitPromise as unknown as Promise<
      Collection<Record<string, unknown>>
    >
  )

  return firstCommitPromise
}

/**
 * Custom error class for schema validation errors
 */
export class SchemaValidationError extends Error {
  type: `insert` | `update`
  issues: ReadonlyArray<{
    message: string
    path?: ReadonlyArray<string | number | symbol>
  }>

  constructor(
    type: `insert` | `update`,
    issues: ReadonlyArray<{
      message: string
      path?: ReadonlyArray<string | number | symbol>
    }>,
    message?: string
  ) {
    const defaultMessage = `${type === `insert` ? `Insert` : `Update`} validation failed: ${issues
      .map((issue) => issue.message)
      .join(`, `)}`

    super(message || defaultMessage)
    this.name = `SchemaValidationError`
    this.type = type
    this.issues = issues
  }
}

export class Collection<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> {
  public transactions: SortedMap<string, Transaction>

  // Core state - make public for testing
  public syncedData = new Map<TKey, T>()
  public syncedMetadata = new Map<TKey, unknown>()

  // Optimistic state tracking - make public for testing
  public derivedUpserts = new Map<TKey, T>()
  public derivedDeletes = new Set<TKey>()

  // Cached size for performance
  private _size = 0

  // Event system
  private eventListeners = new Set<EventListener<T, TKey>>()
  private keyListeners = new Map<TKey, Set<KeyListener<T>>>()

  // Batching for subscribeChanges
  private changesBatchListeners = new Set<
    (changes: Array<ChangeMessage<T>>) => void
  >()

  private pendingSyncedTransactions: Array<PendingSyncedTransaction<T>> = []
  private syncedKeys = new Set<TKey>()
  public config: CollectionConfig<T, TKey>
  private hasReceivedFirstCommit = false

  // Array to store one-time commit listeners
  private onFirstCommitCallbacks: Array<() => void> = []

  /**
   * Register a callback to be executed on the next commit
   * Useful for preloading collections
   * @param callback Function to call after the next commit
   */
  public onFirstCommit(callback: () => void): void {
    this.onFirstCommitCallbacks.push(callback)
  }

  public id = ``

  /**
   * Creates a new Collection instance
   *
   * @param config - Configuration object for the collection
   * @throws Error if sync config is missing
   */
  constructor(config: CollectionConfig<T, TKey>) {
    // eslint-disable-next-line
    if (!config) {
      throw new Error(`Collection requires a config`)
    }
    if (config.id) {
      this.id = config.id
    } else {
      this.id = crypto.randomUUID()
    }

    // eslint-disable-next-line
    if (!config.sync) {
      throw new Error(`Collection requires a sync config`)
    }

    this.transactions = new SortedMap<string, Transaction>(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    )

    this.config = config

    // Start the sync process
    config.sync.sync({
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
          throw new Error(`No pending sync transaction to write to`)
        }
        if (pendingTransaction.committed) {
          throw new Error(
            `The pending sync transaction is already committed, you can't still write to it.`
          )
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
            throw new Error(
              `Cannot insert document with key "${key}" from sync because it already exists in the collection "${this.id}"`
            )
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
          throw new Error(`No pending sync transaction to commit`)
        }
        if (pendingTransaction.committed) {
          throw new Error(
            `The pending sync transaction is already committed, you can't commit it again.`
          )
        }

        pendingTransaction.committed = true
        this.commitPendingTransactions()
      },
    })
  }

  /**
   * Recompute optimistic state from active transactions
   */
  private recomputeOptimisticState(): void {
    const previousState = new Map(this.derivedUpserts)
    const previousDeletes = new Set(this.derivedDeletes)

    // Clear current optimistic state
    this.derivedUpserts.clear()
    this.derivedDeletes.clear()

    // Apply active transactions
    const activeTransactions = Array.from(this.transactions.values())
    for (const transaction of activeTransactions) {
      if (![`completed`, `failed`].includes(transaction.state)) {
        for (const mutation of transaction.mutations) {
          if (mutation.collection === this) {
            switch (mutation.type) {
              case `insert`:
              case `update`:
                this.derivedUpserts.set(mutation.key, mutation.modified as T)
                this.derivedDeletes.delete(mutation.key)
                break
              case `delete`:
                this.derivedUpserts.delete(mutation.key)
                this.derivedDeletes.add(mutation.key)
                break
            }
          }
        }
      }
    }

    // Update cached size
    this._size = this.calculateSize()

    // Collect events for changes
    const events: Array<CollectionEvent<T, TKey>> = []
    this.collectOptimisticChanges(previousState, previousDeletes, events)

    // Emit all events at once
    this.emitEvents(events)
  }

  /**
   * Calculate the current size based on synced data and optimistic changes
   */
  private calculateSize(): number {
    const syncedSize = this.syncedData.size
    const deletesFromSynced = Array.from(this.derivedDeletes).filter(
      (key) => this.syncedData.has(key) && !this.derivedUpserts.has(key)
    ).length
    const upsertsNotInSynced = Array.from(this.derivedUpserts.keys()).filter(
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
    events: Array<CollectionEvent<T, TKey>>
  ): void {
    const allKeys = new Set([
      ...previousUpserts.keys(),
      ...this.derivedUpserts.keys(),
      ...previousDeletes,
      ...this.derivedDeletes,
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
   * Emit multiple events at once to all listeners
   */
  private emitEvents(events: Array<CollectionEvent<T, TKey>>): void {
    // Emit to individual event listeners
    for (const event of events) {
      this.emitEvent(event)
    }

    // Convert to ChangeMessage format and emit to subscribeChanges listeners
    if (events.length > 0) {
      const changeMessages: Array<ChangeMessage<T>> = events.map((event) => {
        const changeMessage: ChangeMessage<T> = {
          type: event.type,
          key: event.key,
          value: event.value,
        }

        if (event.previousValue) {
          ;(changeMessage as any).previousValue = event.previousValue
        }

        return changeMessage
      })

      for (const listener of this.changesBatchListeners) {
        listener(changeMessages)
      }
    }
  }

  /**
   * Emit an event to individual listeners (not batched)
   */
  private emitEvent(event: CollectionEvent<T, TKey>): void {
    // Emit to general listeners
    for (const listener of this.eventListeners) {
      listener(event)
    }

    // Emit to key-specific listeners
    const keyListeners = this.keyListeners.get(event.key)
    if (keyListeners) {
      for (const listener of keyListeners) {
        listener(
          event.type === `delete` ? undefined : event.value,
          event.previousValue
        )
      }
    }
  }

  /**
   * Subscribe to collection events
   */
  public subscribe(listener: EventListener<T, TKey>): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  /**
   * Subscribe to changes for a specific key
   */
  public subscribeKey(key: TKey, listener: KeyListener<T>): () => void {
    if (!this.keyListeners.has(key)) {
      this.keyListeners.set(key, new Set())
    }
    this.keyListeners.get(key)!.add(listener)

    return () => {
      const listeners = this.keyListeners.get(key)
      if (listeners) {
        listeners.delete(listener)
        if (listeners.size === 0) {
          this.keyListeners.delete(key)
        }
      }
    }
  }

  /**
   * Get the current value for a key (virtual derived state)
   */
  public get(key: TKey): T | undefined {
    // Check if optimistically deleted
    if (this.derivedDeletes.has(key)) {
      return undefined
    }

    // Check optimistic upserts first
    if (this.derivedUpserts.has(key)) {
      return this.derivedUpserts.get(key)
    }

    // Fall back to synced data
    return this.syncedData.get(key)
  }

  /**
   * Check if a key exists in the collection (virtual derived state)
   */
  public has(key: TKey): boolean {
    // Check if optimistically deleted
    if (this.derivedDeletes.has(key)) {
      return false
    }

    // Check optimistic upserts first
    if (this.derivedUpserts.has(key)) {
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
      if (!this.derivedDeletes.has(key)) {
        yield key
      }
    }
    // Yield keys from upserts that were not already in synced data.
    for (const key of this.derivedUpserts.keys()) {
      if (!this.syncedData.has(key) && !this.derivedDeletes.has(key)) {
        // The derivedDeletes check is technically redundant if inserts/updates always remove from deletes,
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
   * Attempts to commit pending synced transactions if there are no active transactions
   * This method processes operations from pending transactions and applies them to the synced data
   */
  commitPendingTransactions = () => {
    if (
      !Array.from(this.transactions.values()).some(
        ({ state }) => state === `persisting`
      )
    ) {
      const changedKeys = new Set<TKey>()
      const events: Array<CollectionEvent<T, TKey>> = []

      for (const transaction of this.pendingSyncedTransactions) {
        for (const operation of transaction.operations) {
          const key = operation.key as TKey
          changedKeys.add(key)
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

          // Update synced data and collect events
          const previousValue = this.syncedData.get(key)

          switch (operation.type) {
            case `insert`:
              this.syncedData.set(key, operation.value)
              if (
                !this.derivedDeletes.has(key) &&
                !this.derivedUpserts.has(key)
              ) {
                events.push({
                  type: `insert`,
                  key,
                  value: operation.value,
                })
              }
              break
            case `update`: {
              const updatedValue = Object.assign(
                {},
                this.syncedData.get(key),
                operation.value
              )
              this.syncedData.set(key, updatedValue)
              if (
                !this.derivedDeletes.has(key) &&
                !this.derivedUpserts.has(key)
              ) {
                events.push({
                  type: `update`,
                  key,
                  value: updatedValue,
                  previousValue,
                })
              }
              break
            }
            case `delete`:
              this.syncedData.delete(key)
              if (
                !this.derivedDeletes.has(key) &&
                !this.derivedUpserts.has(key)
              ) {
                if (previousValue) {
                  events.push({
                    type: `delete`,
                    key,
                    value: previousValue,
                  })
                }
              }
              break
          }
        }
      }

      // Update cached size after synced data changes
      this._size = this.calculateSize()

      // Emit all events at once
      this.emitEvents(events)

      this.pendingSyncedTransactions = []

      // Call any registered one-time commit listeners
      if (!this.hasReceivedFirstCommit) {
        this.hasReceivedFirstCommit = true
        const callbacks = [...this.onFirstCommitCallbacks]
        this.onFirstCommitCallbacks = []
        callbacks.forEach((callback) => callback())
      }
    }
  }

  private ensureStandardSchema(schema: unknown): StandardSchema<T> {
    // If the schema already implements the standard-schema interface, return it
    if (schema && typeof schema === `object` && `~standard` in schema) {
      return schema as StandardSchema<T>
    }

    throw new Error(
      `Schema must either implement the standard-schema interface or be a Zod schema`
    )
  }

  public getKeyFromItem(item: T): TKey {
    return this.config.getKey(item)
  }

  public generateGlobalKey(key: any, item: any): string {
    if (typeof key === `undefined`) {
      throw new Error(
        `An object was created without a defined key: ${JSON.stringify(item)}`
      )
    }

    return `KEY::${this.id}/${key}`
  }

  private validateData(
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
          throw new TypeError(`Schema validation must be synchronous`)
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
      throw new TypeError(`Schema validation must be synchronous`)
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
   * @param config - Optional configuration including metadata and custom keys
   * @returns A TransactionType object representing the insert operation(s)
   * @throws {SchemaValidationError} If the data fails schema validation
   * @example
   * // Insert a single item
   * insert({ text: "Buy groceries", completed: false })
   *
   * // Insert multiple items
   * insert([
   *   { text: "Buy groceries", completed: false },
   *   { text: "Walk dog", completed: false }
   * ])
   *
   * // Insert with custom key
   * insert({ text: "Buy groceries" }, { key: "grocery-task" })
   */
  insert = (data: T | Array<T>, config?: InsertConfig) => {
    const ambientTransaction = getActiveTransaction()

    // If no ambient transaction exists, check for an onInsert handler early
    if (!ambientTransaction && !this.config.onInsert) {
      throw new Error(
        `Collection.insert called directly (not within an explicit transaction) but no 'onInsert' handler is configured.`
      )
    }

    const items = Array.isArray(data) ? data : [data]
    const mutations: Array<PendingMutation<T>> = []

    // Create mutations for each item
    items.forEach((item, index) => {
      // Validate the data against the schema if one exists
      const validatedData = this.validateData(item, `insert`)

      // Check if an item with this ID already exists in the collection
      const key = this.getKeyFromItem(item)
      if (this.has(key)) {
        throw `Cannot insert document with ID "${key}" because it already exists in the collection`
      }
      const globalKey = this.generateGlobalKey(key, item)

      const mutation: PendingMutation<T> = {
        mutationId: crypto.randomUUID(),
        original: {},
        modified: validatedData as Record<string, unknown>,
        changes: validatedData as Record<string, unknown>,
        globalKey,
        key,
        metadata: config?.metadata as unknown,
        syncMetadata: this.config.sync.getSyncMetadata?.() || {},
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
      this.recomputeOptimisticState()

      return ambientTransaction
    } else {
      // Create a new transaction with a mutation function that calls the onInsert handler
      const directOpTransaction = new Transaction({
        mutationFn: async (params) => {
          // Call the onInsert handler with the transaction
          return this.config.onInsert!(params)
        },
      })

      // Apply mutations to the new transaction
      directOpTransaction.applyMutations(mutations)
      directOpTransaction.commit()

      // Add the transaction to the collection's transactions store
      this.transactions.set(directOpTransaction.id, directOpTransaction)
      this.recomputeOptimisticState()

      return directOpTransaction
    }
  }

  /**
   * Updates one or more items in the collection using a callback function
   * @param items - Single item/key or array of items/keys to update
   * @param configOrCallback - Either update configuration or update callback
   * @param maybeCallback - Update callback if config was provided
   * @returns A Transaction object representing the update operation(s)
   * @throws {SchemaValidationError} If the updated data fails schema validation
   * @example
   * // Update a single item
   * update(todo, (draft) => { draft.completed = true })
   *
   * // Update multiple items
   * update([todo1, todo2], (drafts) => {
   *   drafts.forEach(draft => { draft.completed = true })
   * })
   *
   * // Update with metadata
   * update(todo, { metadata: { reason: "user update" } }, (draft) => { draft.text = "Updated text" })
   */

  /**
   * Updates one or more items in the collection using a callback function
   * @param ids - Single ID or array of IDs to update
   * @param configOrCallback - Either update configuration or update callback
   * @param maybeCallback - Update callback if config was provided
   * @returns A Transaction object representing the update operation(s)
   * @throws {SchemaValidationError} If the updated data fails schema validation
   * @example
   * // Update a single item
   * update("todo-1", (draft) => { draft.completed = true })
   *
   * // Update multiple items
   * update(["todo-1", "todo-2"], (drafts) => {
   *   drafts.forEach(draft => { draft.completed = true })
   * })
   *
   * // Update with metadata
   * update("todo-1", { metadata: { reason: "user update" } }, (draft) => { draft.text = "Updated text" })
   */
  update<TItem extends object = T>(
    key: TKey,
    configOrCallback: ((draft: TItem) => void) | OperationConfig,
    maybeCallback?: (draft: TItem) => void
  ): TransactionType

  update<TItem extends object = T>(
    keys: Array<TKey>,
    configOrCallback: ((draft: Array<TItem>) => void) | OperationConfig,
    maybeCallback?: (draft: Array<TItem>) => void
  ): TransactionType

  update<TItem extends object = T>(
    keys: TKey | Array<TKey>,
    configOrCallback: ((draft: TItem | Array<TItem>) => void) | OperationConfig,
    maybeCallback?: (draft: TItem | Array<TItem>) => void
  ) {
    if (typeof keys === `undefined`) {
      throw new Error(`The first argument to update is missing`)
    }

    const ambientTransaction = getActiveTransaction()

    // If no ambient transaction exists, check for an onUpdate handler early
    if (!ambientTransaction && !this.config.onUpdate) {
      throw new Error(
        `Collection.update called directly (not within an explicit transaction) but no 'onUpdate' handler is configured.`
      )
    }

    const isArray = Array.isArray(keys)
    const keysArray = isArray ? keys : [keys]

    if (isArray && keysArray.length === 0) {
      throw new Error(`No keys were passed to update`)
    }

    const callback =
      typeof configOrCallback === `function` ? configOrCallback : maybeCallback!
    const config =
      typeof configOrCallback === `function` ? {} : configOrCallback

    // Get the current objects or empty objects if they don't exist
    const currentObjects = keysArray.map((key) => {
      const item = this.get(key)
      if (!item) {
        throw new Error(
          `The key "${key}" was passed to update but an object for this key was not found in the collection`
        )
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
    const mutations: Array<PendingMutation<T>> = keysArray
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
          throw new Error(
            `Updating the key of an item is not allowed. Original key: "${originalItemId}", Attempted new key: "${modifiedItemId}". Please delete the old item and create a new one if a key change is necessary.`
          )
        }

        const globalKey = this.generateGlobalKey(modifiedItemId, modifiedItem)

        return {
          mutationId: crypto.randomUUID(),
          original: originalItem as Record<string, unknown>,
          modified: modifiedItem as Record<string, unknown>,
          changes: validatedUpdatePayload as Record<string, unknown>,
          globalKey,
          key,
          metadata: config.metadata as unknown,
          syncMetadata: (this.syncedMetadata.get(key) || {}) as Record<
            string,
            unknown
          >,
          type: `update`,
          createdAt: new Date(),
          updatedAt: new Date(),
          collection: this,
        }
      })
      .filter(Boolean) as Array<PendingMutation<T>>

    // If no changes were made, return early
    if (mutations.length === 0) {
      throw new Error(`No changes were made to any of the objects`)
    }

    // If an ambient transaction exists, use it
    if (ambientTransaction) {
      ambientTransaction.applyMutations(mutations)

      this.transactions.set(ambientTransaction.id, ambientTransaction)
      this.recomputeOptimisticState()

      return ambientTransaction
    }

    // No need to check for onUpdate handler here as we've already checked at the beginning

    // Create a new transaction with a mutation function that calls the onUpdate handler
    const directOpTransaction = new Transaction({
      mutationFn: async (transaction) => {
        // Call the onUpdate handler with the transaction
        return this.config.onUpdate!(transaction)
      },
    })

    // Apply mutations to the new transaction
    directOpTransaction.applyMutations(mutations)
    directOpTransaction.commit()

    // Add the transaction to the collection's transactions store

    this.transactions.set(directOpTransaction.id, directOpTransaction)
    this.recomputeOptimisticState()

    return directOpTransaction
  }

  /**
   * Deletes one or more items from the collection
   * @param ids - Single ID or array of IDs to delete
   * @param config - Optional configuration including metadata
   * @returns A TransactionType object representing the delete operation(s)
   * @example
   * // Delete a single item
   * delete("todo-1")
   *
   * // Delete multiple items
   * delete(["todo-1", "todo-2"])
   *
   * // Delete with metadata
   * delete("todo-1", { metadata: { reason: "completed" } })
   */
  delete = (
    keys: Array<TKey> | TKey,
    config?: OperationConfig
  ): TransactionType => {
    const ambientTransaction = getActiveTransaction()

    // If no ambient transaction exists, check for an onDelete handler early
    if (!ambientTransaction && !this.config.onDelete) {
      throw new Error(
        `Collection.delete called directly (not within an explicit transaction) but no 'onDelete' handler is configured.`
      )
    }

    if (Array.isArray(keys) && keys.length === 0) {
      throw new Error(`No keys were passed to delete`)
    }

    const keysArray = Array.isArray(keys) ? keys : [keys]
    const mutations: Array<PendingMutation<T>> = []

    for (const key of keysArray) {
      const globalKey = this.generateGlobalKey(key, this.get(key)!)
      const mutation: PendingMutation<T> = {
        mutationId: crypto.randomUUID(),
        original: (this.get(key) || {}) as Record<string, unknown>,
        modified: (this.get(key) || {}) as Record<string, unknown>,
        changes: (this.get(key) || {}) as Record<string, unknown>,
        globalKey,
        key,
        metadata: config?.metadata as unknown,
        syncMetadata: (this.syncedMetadata.get(key) || {}) as Record<
          string,
          unknown
        >,
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
      this.recomputeOptimisticState()

      return ambientTransaction
    }

    // Create a new transaction with a mutation function that calls the onDelete handler
    const directOpTransaction = new Transaction({
      autoCommit: true,
      mutationFn: async (transaction) => {
        // Call the onDelete handler with the transaction
        return this.config.onDelete!(transaction)
      },
    })

    // Apply mutations to the new transaction
    directOpTransaction.applyMutations(mutations)
    directOpTransaction.commit()

    this.transactions.set(directOpTransaction.id, directOpTransaction)
    this.recomputeOptimisticState()

    return directOpTransaction
  }

  /**
   * Gets the current state of the collection as a Map
   *
   * @returns A Map containing all items in the collection, with keys as identifiers
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
    // If we already have data or there are no loading collections, resolve immediately
    if (this.size > 0 || this.hasReceivedFirstCommit === true) {
      return Promise.resolve(this.state)
    }

    // Otherwise, wait for the first commit
    return new Promise<Map<TKey, T>>((resolve) => {
      this.onFirstCommit(() => {
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
    const array = Array.from(this.values())

    // Currently a query with an orderBy will add a _orderByIndex to the items
    // so for now we need to sort the array by _orderByIndex if it exists
    // TODO: in the future it would be much better is the keys are sorted - this
    // should be done by the query engine.
    if (array[0] && (array[0] as { _orderByIndex?: number })._orderByIndex) {
      return (array as Array<{ _orderByIndex: number }>).sort(
        (a, b) => a._orderByIndex - b._orderByIndex
      ) as Array<T>
    }

    return array
  }

  /**
   * Gets the current state of the collection as an Array, but only resolves when data is available
   * Waits for the first sync commit to complete before resolving
   *
   * @returns Promise that resolves to an Array containing all items in the collection
   */
  toArrayWhenReady(): Promise<Array<T>> {
    // If we already have data or there are no loading collections, resolve immediately
    if (this.size > 0 || this.hasReceivedFirstCommit === true) {
      return Promise.resolve(this.toArray)
    }

    // Otherwise, wait for the first commit
    return new Promise<Array<T>>((resolve) => {
      this.onFirstCommit(() => {
        resolve(this.toArray)
      })
    })
  }

  /**
   * Returns the current state of the collection as an array of changes
   * @returns An array of changes
   */
  public currentStateAsChanges(): Array<ChangeMessage<T>> {
    return Array.from(this.entries()).map(([key, value]) => ({
      type: `insert`,
      key,
      value,
    }))
  }

  /**
   * Subscribe to changes in the collection
   * @param callback - A function that will be called with the changes in the collection
   * @returns A function that can be called to unsubscribe from the changes
   */
  public subscribeChanges(
    callback: (changes: Array<ChangeMessage<T>>) => void
  ): () => void {
    // First send the current state as changes
    callback(this.currentStateAsChanges())

    // Add to batched listeners
    this.changesBatchListeners.add(callback)

    return () => {
      this.changesBatchListeners.delete(callback)
    }
  }

  /**
   * Trigger a recomputation when transactions change
   * This method should be called by the Transaction class when state changes
   */
  public onTransactionStateChange(): void {
    this.recomputeOptimisticState()
  }
}
