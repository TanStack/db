import { Store, Derived, batch } from "@tanstack/store"
import {
  SyncConfig,
  MutationFn,
  ChangeMessage,
  PendingMutation,
  Transaction,
  TransactionState,
  StandardSchema,
  InsertConfig,
  OperationConfig,
} from "./types"
import { withChangeTracking, withArrayChangeTracking } from "./lib/proxy"
import { getTransactionManager } from "./TransactionManager"
import { TransactionStore } from "./TransactionStore"

export interface CollectionConfig<T extends object = Record<string, unknown>> {
  sync: SyncConfig<T>
  mutationFn: MutationFn<T>
  schema?: StandardSchema<T>
}

interface PendingSyncedTransaction<T extends object = Record<string, unknown>> {
  committed: boolean
  operations: ChangeMessage<T>[]
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
  public transactionManager!: ReturnType<typeof getTransactionManager<T>>
  private transactionStore: TransactionStore

  public optimisticOperations: Derived<ChangeMessage<T>[]>
  public derivedState: Derived<Map<string, T>>

  private syncedData = new Store<Map<string, T>>(new Map())
  public syncedMetadata = new Store(new Map<string, unknown>())
  private pendingSyncedTransactions: PendingSyncedTransaction<T>[] = []
  public config: CollectionConfig<T>

  // WeakMap to associate objects with their keys
  public objectKeyMap = new WeakMap<object, string>()

  public id = crypto.randomUUID()

  /**
   * Creates a new Collection instance
   *
   * @param config - Configuration object for the collection
   * @throws Error if sync config or mutationFn is missing
   */
  constructor(config?: CollectionConfig<T>) {
    if (!config?.sync) {
      throw new Error(`Collection requires a sync config`)
    }
    if (!config?.mutationFn && !config?.mutationFn?.persist) {
      throw new Error(`Collection requires a mutationFn`)
    }

    this.transactionStore = new TransactionStore()
    this.transactionManager = getTransactionManager<T>(
      this.transactionStore,
      this
    )

    // Copies of live mutations are stored here and removed once the transaction completes.
    this.optimisticOperations = new Derived({
      fn: ({ currDepVals: [transactions] }) => {
        const result = Array.from(transactions.values())
          .filter(
            (transaction) =>
              transaction.state !== `completed` &&
              transaction.state !== `failed`
          )
          .map((transaction) =>
            transaction.mutations.map((mutation) => {
              const message: ChangeMessage<T> = {
                type: mutation.type,
                key: mutation.key,
                value: mutation.modified as T,
              }
              if (
                mutation.metadata !== undefined &&
                mutation.metadata !== null
              ) {
                message.metadata = mutation.metadata as Record<string, unknown>
              }
              return message
            })
          )
          .flat()

        return result
      },
      deps: [this.transactionManager.transactions],
    })
    this.optimisticOperations.mount()

    // Combine together synced data & optimistic operations.
    this.derivedState = new Derived({
      fn: ({ currDepVals: [syncedData, operations] }) => {
        const combined = new Map<string, T>(syncedData)
        // Apply the optimistic operations on top of the synced state.
        for (const operation of operations) {
          let existingValue
          switch (operation.type) {
            case `insert`:
              combined.set(operation.key, operation.value)
              break
            case `update`:
              existingValue = syncedData.get(operation.key)
              combined.set(operation.key, {
                ...(existingValue || {}),
                ...operation.value,
              } as T)
              break
            case `delete`:
              combined.delete(operation.key)
              break
          }
        }

        // Update object => key mappings
        const optimisticKeys = new Set<string>()
        for (const operation of operations) {
          optimisticKeys.add(operation.key)
        }

        optimisticKeys.forEach((key) => {
          if (combined.has(key)) {
            this.objectKeyMap.set(combined.get(key)!, key)
          }
        })

        return combined
      },
      deps: [this.syncedData, this.optimisticOperations],
    })

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
        if (pendingTransaction.committed) {
          throw new Error(
            `The pending sync transaction is already committed, you can't commit it again.`
          )
        }

        pendingTransaction.committed = true

        this.commitPendingTransactions()
      },
    })

    // Listen to transactions and re-run commitPendingTransactions on changes
    // this.transactionManager.transactions.subscribe(
    //   this.commitPendingTransactions
    // )
  }

  /**
   * Attempts to commit pending synced transactions if there are no active transactions
   * This method processes operations from pending transactions and applies them to the synced data
   */
  commitPendingTransactions = () => {
    // Check if there's any transactions that aren't finished.
    // If not, proceed.
    // If so, subscribe to transactions and keep checking if can proceed.
    //
    // The plan is to have a finer-grained locking but just blocking applying
    // synced data until a persisting transaction is finished seems fine.
    // We also don't yet have support for transactions that don't immediately
    // persist so right now, blocking sync only delays their application for a
    // few hundred milliseconds. So not the worse thing in th world.
    // But something to fix in the future.
    // Create a Set with only the terminal states
    const terminalStates = new Set<TransactionState>([`completed`, `failed`])

    // Function to check if a state is NOT a terminal state
    function isNotTerminalState({ state }: Transaction): boolean {
      return !terminalStates.has(state as TransactionState)
    }
    if (
      this.transactions.size === 0 ||
      !Array.from(this.transactions.values()).some(isNotTerminalState)
    ) {
      const keys = new Set<string>()
      batch(() => {
        for (const transaction of this.pendingSyncedTransactions) {
          for (const operation of transaction.operations) {
            keys.add(operation.key)
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
        const curValue = this.value.get(key)
        if (curValue) {
          this.objectKeyMap.set(curValue, key)
        }
      })

      this.pendingSyncedTransactions = []
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
      const existingData = this.value.get(key)

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

    return Math.abs(h).toString(36)
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
  insert = (data: T | T[], config?: InsertConfig) => {
    const items = Array.isArray(data) ? data : [data]
    const mutations: PendingMutation[] = []

    // Handle keys - convert to array if string, or generate if not provided
    let keys: string[]
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
      const key = keys[index]

      const mutation: PendingMutation = {
        mutationId: crypto.randomUUID(),
        original: {},
        modified: validatedData as Record<string, unknown>,
        changes: validatedData as Record<string, unknown>,
        key,
        metadata: config?.metadata,
        syncMetadata: this.config.sync.getSyncMetadata?.() || {},
        type: `insert`,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mutations.push(mutation)
    })

    return this.transactionManager.applyTransaction(mutations, {
      type: `ordered`,
    })
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

  update<T1 extends object = T>(
    item: T1,
    configOrCallback: ((draft: T1) => void) | OperationConfig,
    maybeCallback?: (draft: T1) => void
  ): Transaction

  // eslint-disable-next-line no-dupe-class-members
  update<T1 extends object = T>(
    items: T1[],
    configOrCallback: ((draft: T1[]) => void) | OperationConfig,
    maybeCallback?: (draft: T1[]) => void
  ): Transaction

  // eslint-disable-next-line no-dupe-class-members
  update<T1 extends object = T>(
    items: T1 | T1[],
    configOrCallback: ((draft: T1 | T1[]) => void) | OperationConfig,
    maybeCallback?: (draft: T1 | T1[]) => void
  ) {
    const itemsArray = Array.isArray(items) ? items : [items]
    const callback =
      typeof configOrCallback === `function` ? configOrCallback : maybeCallback!
    const config =
      typeof configOrCallback === `function` ? {} : configOrCallback

    const keys = itemsArray.map((item) => {
      if (typeof item === `object` && item !== null) {
        const key = this.objectKeyMap.get(item as object)
        if (!key) {
          throw new Error(`Object not found in collection`)
        }
        return key
      }
      throw new Error(`Invalid item type for update - must be an object`)
    })

    // Get the current objects or empty objects if they don't exist
    const currentObjects = keys.map((key) => ({
      ...(this.value.get(key) || {}),
    })) as T1[]

    let changesArray
    if (currentObjects.length > 1) {
      // Use the proxy to track changes for all objects
      changesArray = withArrayChangeTracking(
        currentObjects,
        callback as (draft: T1[]) => void
      )
    } else {
      const result = withChangeTracking(
        currentObjects[0],
        callback as (draft: T1) => void
      )
      changesArray = [result]
    }

    // Create mutations for each object that has changes
    const mutations: PendingMutation[] = keys
      .map((key, index) => {
        const changes = changesArray[index]

        // Skip items with no changes
        if (Object.keys(changes).length === 0) {
          return null
        }

        // Validate the changes for this item
        const validatedData = this.validateData(changes, `update`, key)

        return {
          mutationId: crypto.randomUUID(),
          original: (this.value.get(key) || {}) as Record<string, unknown>,
          modified: {
            ...(this.value.get(key) || {}),
            ...validatedData,
          } as Record<string, unknown>,
          changes: validatedData as Record<string, unknown>,
          key,
          metadata: config.metadata,
          syncMetadata: (this.syncedMetadata.state.get(key) || {}) as Record<
            string,
            unknown
          >,
          type: `update`,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      })
      .filter(Boolean) as PendingMutation[]

    // If no changes were made, return early
    if (mutations.length === 0) {
      throw new Error(`No changes were made to any of the objects`)
    }

    return this.transactionManager.applyTransaction(mutations, {
      type: `ordered`,
    })
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
  delete = (items: (T | string)[] | T | string, config?: OperationConfig) => {
    const itemsArray = Array.isArray(items) ? items : [items]
    const mutations: PendingMutation[] = []

    for (const item of itemsArray) {
      let key: string
      if (typeof item === `object` && item !== null) {
        const objectKey = this.objectKeyMap.get(item as object)
        if (!objectKey) {
          throw new Error(`Object not found in collection`)
        }
        key = objectKey
      } else if (typeof item === `string`) {
        key = item
      } else {
        throw new Error(
          `Invalid item type for delete - must be an object or string key`
        )
      }

      const mutation: PendingMutation = {
        mutationId: crypto.randomUUID(),
        original: (this.value.get(key) || {}) as Record<string, unknown>,
        modified: { _deleted: true },
        changes: { _deleted: true },
        key,
        metadata: config?.metadata,
        syncMetadata: (this.syncedMetadata.state.get(key) || {}) as Record<
          string,
          unknown
        >,
        type: `delete`,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mutations.push(mutation)
    }

    // Delete object => key mapping.
    mutations.forEach((mutation) => {
      const curValue = this.value.get(mutation.key)
      if (curValue) {
        this.objectKeyMap.delete(curValue)
      }
    })

    return this.transactionManager.applyTransaction(mutations, {
      type: `ordered`,
    })
  }

  // TODO should be withTransaction & it shouldn't start saving until it's explicitly started?
  // Not critical for now so we can defer this.
  // withMutation = ({ changes, metadata }: WithMutationParams) => {
  //   const mutations = changes.map((change) => ({
  //     mutationId: crypto.randomUUID(),
  //     original:
  //       changes.map((change) => this.syncedData.state.get(change.key)) || [],
  //     modified: changes.map((change) => {
  //       return {
  //         ...(this.syncedData.state.get(change.key) || {}),
  //         ...change.data,
  //       }
  //     }),
  //     changes: change,
  //     metadata,
  //     createdAt: new Date(),
  //     updatedAt: new Date(),
  //     state: `created` as const,
  //   }))
  //
  //   this.transactionManager.applyTransaction(mutations, { type: `ordered` })
  // }

  /**
   * Gets the current value of the collection as a Map
   *
   * @returns A Map containing all items in the collection, with keys as identifiers
   */
  get value() {
    return this.derivedState.state as Map<string, T>
  }

  /**
   * Gets the current transactions in the collection
   *
   * @returns A SortedMap of all transactions in the collection
   */
  get transactions() {
    return this.transactionManager.transactions.state
  }
}
