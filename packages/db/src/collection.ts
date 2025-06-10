import { withArrayChangeTracking, withChangeTracking } from "./proxy"
import { getActiveTransaction } from "./transactions"
import { SortedMap } from "./SortedMap"
import type {
  ChangeMessage,
  CollectionConfig,
  InsertConfig,
  OperationConfig,
  OptimisticChangeMessage,
  PendingMutation,
  StandardSchema,
  Transaction,
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

interface CollectionEvent<T> {
  type: CollectionEventType
  key: string
  value: T
  previousValue?: T
}

type EventListener<T> = (event: CollectionEvent<T>) => void
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
export function createCollection<T extends object = Record<string, unknown>>(
  config: CollectionConfig<T>
): Collection<T> {
  return new Collection<T>(config)
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
export function preloadCollection<T extends object = Record<string, unknown>>(
  config: CollectionConfig<T>
): Promise<Collection<T>> {
  if (!config.id) {
    throw new Error(`The id property is required for preloadCollection`)
  }

  // If the collection is already fully loaded, return a resolved promise
  if (collectionsStore.has(config.id) && !loadingCollections.has(config.id)) {
    return Promise.resolve(collectionsStore.get(config.id)! as Collection<T>)
  }

  // If the collection is in the process of loading, return its promise
  if (loadingCollections.has(config.id)) {
    return loadingCollections.get(config.id)! as Promise<Collection<T>>
  }

  // Create a new collection instance if it doesn't exist
  if (!collectionsStore.has(config.id)) {
    collectionsStore.set(
      config.id,
      new Collection<T>({
        id: config.id,
        getId: config.getId,
        sync: config.sync,
        schema: config.schema,
      })
    )
  }

  const collection = collectionsStore.get(config.id)! as Collection<T>

  // Create a promise that will resolve after the first commit
  let resolveFirstCommit: () => void
  const firstCommitPromise = new Promise<Collection<T>>((resolve) => {
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
    firstCommitPromise as Promise<Collection<Record<string, unknown>>>
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

export class Collection<T extends object = Record<string, unknown>> {
  public transactions: SortedMap<string, Transaction>

  // Core state - make public for testing
  public syncedData = new Map<string, T>()
  public syncedMetadata = new Map<string, unknown>()

  // Optimistic state tracking - make public for testing
  public derivedUpserts = new Map<string, T>()
  public derivedDeletes = new Set<string>()

  // Cached size for performance
  private _size = 0

  // Event system
  private eventListeners = new Set<EventListener<T>>()
  private keyListeners = new Map<string, Set<KeyListener<T>>>()

  // Batching for subscribeChanges
  private changesBatchListeners = new Set<
    (changes: Array<ChangeMessage<T>>) => void
  >()

  private pendingSyncedTransactions: Array<PendingSyncedTransaction<T>> = []
  private syncedKeys = new Set<string>()
  public config: CollectionConfig<T>
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
  constructor(config: CollectionConfig<T>) {
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
        const key = this.generateObjectKey(
          this.config.getId(messageWithoutKey.value),
          messageWithoutKey.value
        )

        // Check if an item with this ID already exists when inserting
        if (messageWithoutKey.type === `insert`) {
          if (
            this.syncedData.has(key) &&
            !pendingTransaction.operations.some(
              (op) => op.key === key && op.type === `delete`
            )
          ) {
            const id = this.config.getId(messageWithoutKey.value)
            throw new Error(
              `Cannot insert document with ID "${id}" from sync because it already exists in the collection "${this.id}"`
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
    const events: Array<CollectionEvent<T>> = []
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
    previousUpserts: Map<string, T>,
    previousDeletes: Set<string>,
    events: Array<CollectionEvent<T>>
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
    key: string,
    previousUpserts: Map<string, T>,
    previousDeletes: Set<string>
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
  private emitEvents(events: Array<CollectionEvent<T>>): void {
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
  private emitEvent(event: CollectionEvent<T>): void {
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
  public subscribe(listener: EventListener<T>): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  /**
   * Subscribe to changes for a specific key
   */
  public subscribeKey(key: string, listener: KeyListener<T>): () => void {
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
  public get(key: string): T | undefined {
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
  public has(key: string): boolean {
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
  public *keys(): IterableIterator<string> {
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
  public *entries(): IterableIterator<[string, T]> {
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
      const changedKeys = new Set<string>()
      const events: Array<CollectionEvent<T>> = []

      for (const transaction of this.pendingSyncedTransactions) {
        for (const operation of transaction.operations) {
          changedKeys.add(operation.key)
          this.syncedKeys.add(operation.key)

          // Update metadata
          switch (operation.type) {
            case `insert`:
              this.syncedMetadata.set(operation.key, operation.metadata)
              break
            case `update`:
              this.syncedMetadata.set(
                operation.key,
                Object.assign(
                  {},
                  this.syncedMetadata.get(operation.key),
                  operation.metadata
                )
              )
              break
            case `delete`:
              this.syncedMetadata.delete(operation.key)
              break
          }

          // Update synced data and collect events
          const previousValue = this.syncedData.get(operation.key)

          switch (operation.type) {
            case `insert`:
              this.syncedData.set(operation.key, operation.value)
              if (
                !this.derivedDeletes.has(operation.key) &&
                !this.derivedUpserts.has(operation.key)
              ) {
                events.push({
                  type: `insert`,
                  key: operation.key,
                  value: operation.value,
                })
              }
              break
            case `update`: {
              const updatedValue = Object.assign(
                {},
                this.syncedData.get(operation.key),
                operation.value
              )
              this.syncedData.set(operation.key, updatedValue)
              if (
                !this.derivedDeletes.has(operation.key) &&
                !this.derivedUpserts.has(operation.key)
              ) {
                events.push({
                  type: `update`,
                  key: operation.key,
                  value: updatedValue,
                  previousValue,
                })
              }
              break
            }
            case `delete`:
              this.syncedData.delete(operation.key)
              if (
                !this.derivedDeletes.has(operation.key) &&
                !this.derivedUpserts.has(operation.key)
              ) {
                if (previousValue) {
                  events.push({
                    type: `delete`,
                    key: operation.key,
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

  private getKeyFromId(id: unknown): string {
    if (typeof id === `undefined`) {
      throw new Error(`id is undefined`)
    }
    if (typeof id === `string` && id.startsWith(`KEY::`)) {
      return id
    } else {
      // if it's not a string, then it's some other
      // primitive type and needs turned into a key.
      return this.generateObjectKey(id, null)
    }
  }

  public generateObjectKey(id: any, item: any): string {
    if (typeof id === `undefined`) {
      throw new Error(
        `An object was created without a defined id: ${JSON.stringify(item)}`
      )
    }

    return `KEY::${this.id}/${id}`
  }

  private validateData(
    data: unknown,
    type: `insert` | `update`,
    key?: string
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
   * @returns A Transaction object representing the insert operation(s)
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
    const transaction = getActiveTransaction()
    if (typeof transaction === `undefined`) {
      throw `no transaction found when calling collection.insert`
    }

    const items = Array.isArray(data) ? data : [data]
    const mutations: Array<PendingMutation<T>> = []

    // Handle keys - convert to array if string, or generate if not provided
    const keys: Array<unknown> = items.map((item) =>
      this.generateObjectKey(this.config.getId(item), item)
    )

    // Create mutations for each item
    items.forEach((item, index) => {
      // Validate the data against the schema if one exists
      const validatedData = this.validateData(item, `insert`)
      const key = keys[index]!

      // Check if an item with this ID already exists in the collection
      const id = this.config.getId(item)
      if (this.has(this.getKeyFromId(id))) {
        throw `Cannot insert document with ID "${id}" because it already exists in the collection`
      }

      const mutation: PendingMutation<T> = {
        mutationId: crypto.randomUUID(),
        original: {},
        modified: validatedData as Record<string, unknown>,
        changes: validatedData as Record<string, unknown>,
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

    transaction.applyMutations(mutations)

    this.transactions.set(transaction.id, transaction)
    this.recomputeOptimisticState()

    return transaction
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
    id: unknown,
    configOrCallback: ((draft: TItem) => void) | OperationConfig,
    maybeCallback?: (draft: TItem) => void
  ): Transaction

  update<TItem extends object = T>(
    ids: Array<unknown>,
    configOrCallback: ((draft: Array<TItem>) => void) | OperationConfig,
    maybeCallback?: (draft: Array<TItem>) => void
  ): Transaction

  update<TItem extends object = T>(
    ids: unknown | Array<unknown>,
    configOrCallback: ((draft: TItem | Array<TItem>) => void) | OperationConfig,
    maybeCallback?: (draft: TItem | Array<TItem>) => void
  ) {
    if (typeof ids === `undefined`) {
      throw new Error(`The first argument to update is missing`)
    }

    const transaction = getActiveTransaction()
    if (typeof transaction === `undefined`) {
      throw `no transaction found when calling collection.update`
    }

    const isArray = Array.isArray(ids)
    const idsArray = (Array.isArray(ids) ? ids : [ids]).map((id) =>
      this.getKeyFromId(id)
    )
    const callback =
      typeof configOrCallback === `function` ? configOrCallback : maybeCallback!
    const config =
      typeof configOrCallback === `function` ? {} : configOrCallback

    // Get the current objects or empty objects if they don't exist
    const currentObjects = idsArray.map((id) => {
      const item = this.get(id)
      if (!item) {
        throw new Error(
          `The id "${id}" was passed to update but an object for this ID was not found in the collection`
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
        currentObjects[0] as TItem,
        callback as (draft: TItem) => void
      )
      changesArray = [result]
    }

    // Create mutations for each object that has changes
    const mutations: Array<PendingMutation<T>> = idsArray
      .map((id, index) => {
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
          id
        )

        // Construct the full modified item by applying the validated update payload to the original item
        const modifiedItem = Object.assign(
          {},
          originalItem,
          validatedUpdatePayload
        )

        // Check if the ID of the item is being changed
        const originalItemId = this.config.getId(originalItem)
        const modifiedItemId = this.config.getId(modifiedItem)

        if (originalItemId !== modifiedItemId) {
          throw new Error(
            `Updating the ID of an item is not allowed. Original ID: "${originalItemId}", Attempted new ID: "${modifiedItemId}". Please delete the old item and create a new one if an ID change is necessary.`
          )
        }

        return {
          mutationId: crypto.randomUUID(),
          original: originalItem as Record<string, unknown>,
          modified: modifiedItem as Record<string, unknown>,
          changes: validatedUpdatePayload as Record<string, unknown>,
          key: id,
          metadata: config.metadata as unknown,
          syncMetadata: (this.syncedMetadata.get(id) || {}) as Record<
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

    transaction.applyMutations(mutations)

    this.transactions.set(transaction.id, transaction)
    this.recomputeOptimisticState()

    return transaction
  }

  /**
   * Deletes one or more items from the collection
   * @param ids - Single ID or array of IDs to delete
   * @param config - Optional configuration including metadata
   * @returns A Transaction object representing the delete operation(s)
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
  delete = (ids: Array<string> | string, config?: OperationConfig) => {
    const transaction = getActiveTransaction()
    if (typeof transaction === `undefined`) {
      throw `no transaction found when calling collection.delete`
    }

    const idsArray = (Array.isArray(ids) ? ids : [ids]).map((id) =>
      this.getKeyFromId(id)
    )
    const mutations: Array<PendingMutation<T>> = []

    for (const id of idsArray) {
      const mutation: PendingMutation<T> = {
        mutationId: crypto.randomUUID(),
        original: (this.get(id) || {}) as Record<string, unknown>,
        modified: (this.get(id) || {}) as Record<string, unknown>,
        changes: (this.get(id) || {}) as Record<string, unknown>,
        key: id,
        metadata: config?.metadata as unknown,
        syncMetadata: (this.syncedMetadata.get(id) || {}) as Record<
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

    transaction.applyMutations(mutations)

    this.transactions.set(transaction.id, transaction)
    this.recomputeOptimisticState()

    return transaction
  }

  /**
   * Gets the current state of the collection as a Map
   *
   * @returns A Map containing all items in the collection, with keys as identifiers
   */
  get state() {
    const result = new Map<string, T>()
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
  stateWhenReady(): Promise<Map<string, T>> {
    // If we already have data or there are no loading collections, resolve immediately
    if (this.size > 0 || this.hasReceivedFirstCommit === true) {
      return Promise.resolve(this.state)
    }

    // Otherwise, wait for the first commit
    return new Promise<Map<string, T>>((resolve) => {
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
