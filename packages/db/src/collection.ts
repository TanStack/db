import { Derived, Store, batch } from "@tanstack/store"
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

// Store collections in memory using Tanstack store
export const collectionsStore = new Store(new Map<string, Collection<any>>())

// Map to track loading collections

const loadingCollections = new Map<
  string,
  Promise<Collection<Record<string, unknown>>>
>()

interface PendingSyncedTransaction<T extends object = Record<string, unknown>> {
  committed: boolean
  operations: Array<OptimisticChangeMessage<T>>
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
  // If the collection is already fully loaded, return a resolved promise
  if (
    collectionsStore.state.has(config.id) &&
    !loadingCollections.has(config.id)
  ) {
    return Promise.resolve(
      collectionsStore.state.get(config.id)! as Collection<T>
    )
  }

  // If the collection is in the process of loading, return its promise
  if (loadingCollections.has(config.id)) {
    return loadingCollections.get(config.id)! as Promise<Collection<T>>
  }

  // Create a new collection instance if it doesn't exist
  if (!collectionsStore.state.has(config.id)) {
    collectionsStore.setState((prev) => {
      const next = new Map(prev)
      next.set(
        config.id,
        new Collection<T>({
          id: config.id,
          sync: config.sync,
          schema: config.schema,
        })
      )
      return next
    })
  }

  const collection = collectionsStore.state.get(config.id)! as Collection<T>

  // Create a promise that will resolve after the first commit
  let resolveFirstCommit: () => void
  const firstCommitPromise = new Promise<Collection<T>>((resolve) => {
    resolveFirstCommit = () => {
      resolve(collection)
    }
  })

  // Register a one-time listener for the first commit
  collection.onFirstCommit(() => {
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
  public transactions: Store<SortedMap<string, Transaction>>
  public optimisticOperations: Derived<Array<OptimisticChangeMessage<T>>>
  public derivedState: Derived<Map<string, T>>
  public derivedArray: Derived<Array<T>>
  public derivedChanges: Derived<Array<ChangeMessage<T>>>
  public syncedData = new Store<Map<string, T>>(new Map())
  public syncedMetadata = new Store(new Map<string, unknown>())
  private pendingSyncedTransactions: Array<PendingSyncedTransaction<T>> = []
  private syncedKeys = new Set<string>()
  public config: CollectionConfig<T>
  private hasReceivedFirstCommit = false

  // WeakMap to associate objects with their keys
  public objectKeyMap = new WeakMap<object, string>()

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

  public id = crypto.randomUUID()

  /**
   * Creates a new Collection instance
   *
   * @param config - Configuration object for the collection
   * @throws Error if sync config is missing
   */
  constructor(config?: CollectionConfig<T>) {
    if (!config?.sync) {
      throw new Error(`Collection requires a sync config`)
    }

    this.transactions = new Store(
      new SortedMap<string, Transaction>(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      )
    )

    // Copies of live mutations are stored here and removed once the transaction completes.
    this.optimisticOperations = new Derived({
      fn: ({ currDepVals: [transactions] }) => {
        const result = Array.from(transactions.values())
          .map((transaction) => {
            const isActive = ![`completed`, `failed`].includes(
              transaction.state
            )
            return transaction.mutations.map((mutation) => {
              const message: OptimisticChangeMessage<T> = {
                type: mutation.type,
                key: mutation.key,
                value: mutation.modified as T,
                isActive,
              }
              if (
                mutation.metadata !== undefined &&
                mutation.metadata !== null
              ) {
                message.metadata = mutation.metadata as Record<string, unknown>
              }
              return message
            })
          })
          .flat()

        return result
      },
      deps: [this.transactions],
    })
    this.optimisticOperations.mount()

    // Combine together synced data & optimistic operations.
    this.derivedState = new Derived({
      fn: ({ currDepVals: [syncedData, operations] }) => {
        const combined = new Map<string, T>(syncedData)
        const optimisticKeys = new Set<string>()

        // Apply the optimistic operations on top of the synced state.
        for (const operation of operations) {
          optimisticKeys.add(operation.key)
          if (operation.isActive) {
            switch (operation.type) {
              case `insert`:
                combined.set(operation.key, operation.value)
                break
              case `update`:
                combined.set(operation.key, operation.value)
                break
              case `delete`:
                combined.delete(operation.key)
                break
            }
          }
        }

        // Update object => key mappings
        optimisticKeys.forEach((key) => {
          if (combined.has(key)) {
            this.objectKeyMap.set(combined.get(key)!, key)
          }
        })

        return combined
      },
      deps: [this.syncedData, this.optimisticOperations],
    })

    // Create a derived array from the map to avoid recalculating it
    this.derivedArray = new Derived({
      fn: ({ currDepVals: [stateMap] }) => {
        // Collections returned by a query that has an orderBy are annotated
        // with the _orderByIndex field.
        // This is used to sort the array when it's derived.
        const array: Array<T & { _orderByIndex?: number }> = Array.from(
          stateMap.values()
        )
        if (array[0] && `_orderByIndex` in array[0]) {
          ;(array as Array<T & { _orderByIndex: number }>).sort((a, b) => {
            if (a._orderByIndex === b._orderByIndex) {
              return 0
            }
            return a._orderByIndex < b._orderByIndex ? -1 : 1
          })
        }
        return array
      },
      deps: [this.derivedState],
    })
    this.derivedArray.mount()

    this.derivedChanges = new Derived({
      fn: ({
        currDepVals: [derivedState, optimisticOperations],
        prevDepVals,
      }) => {
        const prevDerivedState = prevDepVals?.[0] ?? new Map<string, T>()
        const prevOptimisticOperations = prevDepVals?.[1] ?? []
        const changedKeys = new Set(this.syncedKeys)
        optimisticOperations
          .flat()
          .filter((op) => op.isActive)
          .forEach((op) => changedKeys.add(op.key))
        prevOptimisticOperations.flat().forEach((op) => {
          changedKeys.add(op.key)
        })

        console.log(`+++++++++++++++++++++++++`)
        console.log({
          prevDerivedState,
          derivedState,
          syncedKeys: this.syncedKeys,
          optimisticKeys: optimisticOperations.flat().map((op) => op.key),
          optimisticOperations,
        })

        if (changedKeys.size === 0) {
          console.log(`no changes`)
          return []
        }

        const changes: Array<ChangeMessage<T>> = []
        for (const key of changedKeys) {
          if (prevDerivedState.has(key) && !derivedState.has(key)) {
            changes.push({
              type: `delete`,
              key,
              value: prevDerivedState.get(key)!,
            })
          } else if (!prevDerivedState.has(key) && derivedState.has(key)) {
            changes.push({ type: `insert`, key, value: derivedState.get(key)! })
          } else if (prevDerivedState.has(key) && derivedState.has(key)) {
            const value = derivedState.get(key)!
            const previousValue = prevDerivedState.get(key)
            if (value !== previousValue) {
              // Comparing objects by reference as records are not mutated
              changes.push({
                type: `update`,
                key,
                value,
                previousValue,
              })
            }
          }
        }

        this.syncedKeys.clear()

        console.log({ changes })

        return changes
      },
      deps: [this.derivedState, this.optimisticOperations],
    })
    this.derivedChanges.mount()

    this.config = config

    this.derivedState.mount()

    // Start the sync process
    config.sync.sync({
      collection: this,
      begin: () => {
        this.pendingSyncedTransactions.push({
          committed: false,
          operations: [],
        })
      },
      write: (message: ChangeMessage<T>) => {
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
   * Attempts to commit pending synced transactions if there are no active transactions
   * This method processes operations from pending transactions and applies them to the synced data
   */
  commitPendingTransactions = () => {
    if (
      !Array.from(this.transactions.state.values()).some(
        ({ state }) => state === `persisting`
      )
    ) {
      const keys = new Set<string>()
      batch(() => {
        for (const transaction of this.pendingSyncedTransactions) {
          for (const operation of transaction.operations) {
            keys.add(operation.key)
            this.syncedKeys.add(operation.key)
            this.syncedMetadata.setState((prevData) => {
              switch (operation.type) {
                case `insert`:
                  prevData.set(operation.key, operation.metadata)
                  break
                case `update`:
                  prevData.set(operation.key, {
                    ...prevData.get(operation.key)!,
                    ...operation.metadata,
                  })
                  break
                case `delete`:
                  prevData.delete(operation.key)
                  break
              }
              return prevData
            })
            this.syncedData.setState((prevData) => {
              switch (operation.type) {
                case `insert`:
                  prevData.set(operation.key, operation.value)
                  break
                case `update`:
                  prevData.set(operation.key, {
                    ...prevData.get(operation.key)!,
                    ...operation.value,
                  })
                  break
                case `delete`:
                  prevData.delete(operation.key)
                  break
              }
              return prevData
            })
          }
        }
      })

      keys.forEach((key) => {
        const curValue = this.state.get(key)
        if (curValue) {
          this.objectKeyMap.set(curValue, key)
        }
      })

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
      const existingData = this.state.get(key)

      if (
        existingData &&
        data &&
        typeof data === `object` &&
        typeof existingData === `object`
      ) {
        // Merge the update with the existing data
        const mergedData = { ...existingData, ...data }

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

  private generateKey(data: unknown): string {
    const str = JSON.stringify(data)
    let h = 0

    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
    }

    return `${this.id}/${Math.abs(h).toString(36)}`
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
    let keys: Array<string>
    if (config?.key) {
      const configKeys = Array.isArray(config.key) ? config.key : [config.key]
      // If keys are provided, ensure we have the right number or allow sparse array
      if (Array.isArray(config.key) && configKeys.length > items.length) {
        throw new Error(`More keys provided than items to insert`)
      }
      keys = items.map((_, i) => configKeys[i] ?? this.generateKey(items[i]))
    } else {
      // No keys provided, generate for all items
      keys = items.map((item) => this.generateKey(item))
    }

    // Create mutations for each item
    items.forEach((item, index) => {
      // Validate the data against the schema if one exists
      const validatedData = this.validateData(item, `insert`)
      const key = keys[index]!

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

    this.transactions.setState((sortedMap) => {
      sortedMap.set(transaction.id, transaction)
      return sortedMap
    })

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

  update<TItem extends object = T>(
    item: TItem,
    configOrCallback: ((draft: TItem) => void) | OperationConfig,
    maybeCallback?: (draft: TItem) => void
  ): Transaction

  update<TItem extends object = T>(
    items: Array<TItem>,
    configOrCallback: ((draft: Array<TItem>) => void) | OperationConfig,
    maybeCallback?: (draft: Array<TItem>) => void
  ): Transaction

  update<TItem extends object = T>(
    items: TItem | Array<TItem>,
    configOrCallback: ((draft: TItem | Array<TItem>) => void) | OperationConfig,
    maybeCallback?: (draft: TItem | Array<TItem>) => void
  ) {
    if (typeof items === `undefined`) {
      throw new Error(`The first argument to update is missing`)
    }

    const transaction = getActiveTransaction()
    if (typeof transaction === `undefined`) {
      throw `no transaction found when calling collection.update`
    }

    const isArray = Array.isArray(items)
    const itemsArray = Array.isArray(items) ? items : [items]
    const callback =
      typeof configOrCallback === `function` ? configOrCallback : maybeCallback!
    const config =
      typeof configOrCallback === `function` ? {} : configOrCallback

    const keys = itemsArray.map((item) => {
      if (typeof item === `object` && (item as unknown) !== null) {
        const key = this.objectKeyMap.get(item)
        if (key === undefined) {
          throw new Error(`Object not found in collection`)
        }
        return key
      }
      throw new Error(`Invalid item type for update - must be an object`)
    })

    // Get the current objects or empty objects if they don't exist
    const currentObjects = keys.map((key) => ({
      ...(this.state.get(key) || {}),
    })) as Array<TItem>

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
    const mutations: Array<PendingMutation<T>> = keys
      .map((key, index) => {
        const changes = changesArray[index]

        // Skip items with no changes
        if (!changes || Object.keys(changes).length === 0) {
          return null
        }

        // Validate the changes for this item
        const validatedData = this.validateData(changes, `update`, key)

        return {
          mutationId: crypto.randomUUID(),
          original: (this.state.get(key) || {}) as Record<string, unknown>,
          modified: {
            ...(this.state.get(key) || {}),
            ...validatedData,
          } as Record<string, unknown>,
          changes: validatedData as Record<string, unknown>,
          key,
          metadata: config.metadata as unknown,
          syncMetadata: (this.syncedMetadata.state.get(key) || {}) as Record<
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

    this.transactions.setState((sortedMap) => {
      sortedMap.set(transaction.id, transaction)
      return sortedMap
    })

    return transaction
  }

  /**
   * Deletes one or more items from the collection
   * @param items - Single item/key or array of items/keys to delete
   * @param config - Optional configuration including metadata
   * @returns A Transaction object representing the delete operation(s)
   * @example
   * // Delete a single item
   * delete(todo)
   *
   * // Delete multiple items
   * delete([todo1, todo2])
   *
   * // Delete with metadata
   * delete(todo, { metadata: { reason: "completed" } })
   */
  delete = (
    items: Array<T | string> | T | string,
    config?: OperationConfig
  ) => {
    const transaction = getActiveTransaction()
    if (typeof transaction === `undefined`) {
      throw `no transaction found when calling collection.delete`
    }

    const itemsArray = Array.isArray(items) ? items : [items]
    const mutations: Array<PendingMutation<T>> = []

    for (const item of itemsArray) {
      let key: string
      if (typeof item === `object` && (item as unknown) !== null) {
        const objectKey = this.objectKeyMap.get(item)
        if (objectKey === undefined) {
          throw new Error(
            `Object not found in collection: ${JSON.stringify(item)}`
          )
        }
        key = objectKey
      } else if (typeof item === `string`) {
        key = item
      } else {
        throw new Error(
          `Invalid item type for delete - must be an object or string key`
        )
      }

      const mutation: PendingMutation<T> = {
        mutationId: crypto.randomUUID(),
        original: (this.state.get(key) || {}) as Record<string, unknown>,
        modified: { _deleted: true },
        changes: { _deleted: true },
        key,
        metadata: config?.metadata as unknown,
        syncMetadata: (this.syncedMetadata.state.get(key) || {}) as Record<
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

    // Delete object => key mapping.
    mutations.forEach((mutation) => {
      const curValue = this.state.get(mutation.key)
      if (curValue) {
        this.objectKeyMap.delete(curValue)
      }
    })

    transaction.applyMutations(mutations)

    this.transactions.setState((sortedMap) => {
      sortedMap.set(transaction.id, transaction)
      return sortedMap
    })

    return transaction
  }

  /**
   * Gets the current state of the collection as a Map
   *
   * @returns A Map containing all items in the collection, with keys as identifiers
   */
  get state() {
    return this.derivedState.state
  }

  /**
   * Gets the current state of the collection as a Map, but only resolves when data is available
   * Waits for the first sync commit to complete before resolving
   *
   * @returns Promise that resolves to a Map containing all items in the collection
   */
  stateWhenReady(): Promise<Map<string, T>> {
    // If we already have data or there are no loading collections, resolve immediately
    if (this.state.size > 0 || this.hasReceivedFirstCommit === true) {
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
    return this.derivedArray.state
  }

  /**
   * Gets the current state of the collection as an Array, but only resolves when data is available
   * Waits for the first sync commit to complete before resolving
   *
   * @returns Promise that resolves to an Array containing all items in the collection
   */
  toArrayWhenReady(): Promise<Array<T>> {
    // If we already have data or there are no loading collections, resolve immediately
    if (this.toArray.length > 0 || this.hasReceivedFirstCommit === true) {
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
    return [...this.state.entries()].map(([key, value]) => ({
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

    // Then subscribe to changes, this returns an unsubscribe function
    return this.derivedChanges.subscribe((changes) => {
      if (changes.currentVal.length > 0) {
        callback(changes.currentVal)
      }
    })
  }
}
