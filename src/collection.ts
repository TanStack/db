import { Store, Derived, batch } from "@tanstack/store"
import {
  SyncConfig,
  MutationFn,
  ChangeMessage,
  PendingMutation,
  Row,
  Transaction,
  TransactionState,
  StandardSchema,
} from "./types"
import { withChangeTracking, withArrayChangeTracking } from "./lib/proxy"
import { TransactionManager } from "./TransactionManager"
import { TransactionStore } from "./TransactionStore"
import { z } from "zod"

export interface CollectionConfig<T extends object = Record<string, unknown>> {
  sync: SyncConfig
  mutationFn: MutationFn
  schema?: StandardSchema<T>
}

interface PendingSyncedTransaction {
  committed: boolean
  operations: ChangeMessage[]
}

interface UpdateParams<T extends object = Record<string, unknown>> {
  key: string | T

  data: Partial<T>
  metadata?: unknown
  callback?: (proxy: T) => void
}

interface UpdateArrayParams<T extends object = Record<string, unknown>> {
  key: Array<string | T>

  metadata?: unknown
  callback: (proxies: T[]) => void
}

interface InsertParams<T extends object = Record<string, unknown>> {
  key: string

  data: T
  metadata?: unknown
}

interface DeleteParams {
  key: string | object
  metadata?: unknown
}

/**
 * Custom error class for schema validation errors
 */
export class SchemaValidationError extends Error {
  type: `insert` | `update`
  issues: Array<{ message: string; path?: Array<string | number | symbol> }>

  constructor(
    type: `insert` | `update`,
    issues: Array<{ message: string; path?: Array<string | number | symbol> }>,
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
  public transactionManager: TransactionManager
  private transactionStore: TransactionStore

  public optimisticOperations: Derived<ChangeMessage[]>
  public derivedState: Derived<Map<string, T>>

  private syncedData = new Store(new Map<string, T>())
  public syncedMetadata = new Store(new Map<string, unknown>())
  private pendingSyncedTransactions: PendingSyncedTransaction[] = []
  public config: CollectionConfig<T>

  // WeakMap to associate objects with their keys
  private objectKeyMap = new WeakMap<object, string>()

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
    this.transactionManager = new TransactionManager(
      this.transactionStore,
      this
    )

    // Copies of live mutations are stored here and removed once the transaction completes.
    this.optimisticOperations = new Derived({
      fn: ({ currDepVals }) => {
        const result = Array.from(currDepVals[0].values())
          .filter(
            (transaction) =>
              transaction.state !== `completed` &&
              transaction.state !== `failed`
          )
          .map((transaction) =>
            transaction.mutations.map((mutation) => {
              return {
                type: mutation.type,
                key: mutation.key,
                value: mutation.modified as Row,
              } satisfies ChangeMessage
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
      // prevVal, prevDepVals,
      fn: ({ currDepVals }) => {
        const combined = new Map(currDepVals[0])
        // Apply the optimistic operations on top of the synced state.
        for (const operation of currDepVals[1]) {
          switch (operation.type) {
            case `insert`:
              combined.set(operation.key, operation.value)
              break
            case `update`:
              combined.set(operation.key, {
                ...currDepVals[0].get(operation.key)!,
                ...operation.value,
              })
              break
            case `delete`:
              combined.delete(operation.key)
              break
          }
        }
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
      write: (message: ChangeMessage) => {
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
      batch(() => {
        for (const transaction of this.pendingSyncedTransactions) {
          for (const operation of transaction.operations) {
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

      this.pendingSyncedTransactions = []
    }
  }

  private ensureStandardSchema(schema: unknown): StandardSchema<T> {
    // If the schema already implements the standard-schema interface, return it
    if (schema && typeof schema === `object` && `~standard` in schema) {
      return schema as StandardSchema<T>
    }

    // If it's a Zod schema, create a wrapper that implements the standard-schema interface
    if (schema instanceof z.ZodType) {
      return {
        "~standard": {
          version: 1,
          vendor: `zod`,
          validate: (value: unknown) => {
            try {
              const result = schema.parse(value)
              return { value: result }
            } catch (error) {
              if (error instanceof z.ZodError) {
                return {
                  issues: error.errors.map((err) => ({
                    message: err.message,
                    path: err.path,
                  })),
                }
              }
              return {
                issues: [{ message: String(error) }],
              }
            }
          },
          types: {
            input: {} as T,
            output: {} as T,
          },
        },
      }
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

        // If validation fails, throw a SchemaValidationError with the issues
        if (`issues` in result) {
          throw new SchemaValidationError(type, result.issues)
        }

        // Return the original update data, not the merged data
        // We only used the merged data for validation
        return data as T
      }
    }

    // For inserts or updates without existing data, validate the data directly
    const result = standardSchema[`~standard`].validate(data)

    // If validation fails, throw a SchemaValidationError with the issues
    if (`issues` in result) {
      throw new SchemaValidationError(type, result.issues)
    }

    return result.value as T
  }

  /**
   * Updates an existing item in the collection
   *
   * @param params - Object containing update parameters
   * @param params.key - The unique identifier for the item, or the item object itself, or an array of keys or objects
   * @param params.data - The data to update (partial object) - use either this or callback
   * @param params.callback - Function that receives a proxy of the object and can modify it directly
   * @param params.metadata - Optional metadata to associate with the update
   * @returns A Transaction object representing the update operation
   * @throws SchemaValidationError if the updated data fails schema validation
   */
  update = <T1 extends object = T>(
    params: UpdateParams<T1> | UpdateArrayParams<T1>
  ) => {
    // Handle array update case
    if (
      Array.isArray(params.key) &&
      params.callback &&
      typeof params.callback === `function`
    ) {
      const keys = params.key.map((keyOrObject) => {
        // If it's an object, get its key from the WeakMap
        if (typeof keyOrObject === `object` && keyOrObject !== null) {
          const key = this.objectKeyMap.get(keyOrObject as object)
          if (!key) {
            throw new Error(`Object not found in collection`)
          }
          return key
        }
        // Otherwise, assume it's a key string
        return keyOrObject as string
      })

      const metadata = params.metadata
      const callback = params.callback as (proxies: T1[]) => void

      // Get the current objects or empty objects if they don't exist
      const currentObjects = keys.map((key) => ({
        ...(this.value.get(key) || {}),
      })) as T1[]

      // Use the proxy to track changes for all objects
      const changesArray = withArrayChangeTracking(currentObjects, callback)

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
            metadata,
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
    // Handle single object update case
    else {
      const {
        key: keyOrObject,
        data,
        metadata,
        callback,
      } = params as UpdateParams<T1>

      // Determine the key - either directly provided or from the WeakMap
      let key: string
      if (typeof keyOrObject === `object` && keyOrObject !== null) {
        const objectKey = this.objectKeyMap.get(keyOrObject as object)
        if (!objectKey) {
          throw new Error(`Object not found in collection`)
        }
        key = objectKey
      } else {
        key = keyOrObject as string
      }

      let validatedData: Partial<T1>

      if (callback && typeof callback === `function`) {
        // Get the current object or an empty object if it doesn't exist
        const currentObject = (this.value.get(key) || {}) as T1

        // Use the proxy to track changes
        const changes = withChangeTracking(
          { ...currentObject }, // Create a copy to avoid modifying the original directly
          callback
        )

        // Validate the changes
        validatedData = this.validateData(changes, `update`, key)
      } else if (data) {
        // Use the traditional approach with data object
        validatedData = this.validateData(data, `update`, key)
      } else {
        throw new Error(`Either data or callback must be provided to update`)
      }

      const mutation: PendingMutation = {
        mutationId: crypto.randomUUID(),
        original: (this.value.get(key) || {}) as Record<string, unknown>,
        modified: {
          ...(this.value.get(key) || {}),
          ...validatedData,
        } as Record<string, unknown>,
        changes: validatedData as Record<string, unknown>,
        key,
        metadata,
        syncMetadata: (this.syncedMetadata.state.get(key) || {}) as Record<
          string,
          unknown
        >,
        type: `update`,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      return this.transactionManager.applyTransaction([mutation], {
        type: `ordered`,
      })
    }
  }

  /**
   * Inserts a new item into the collection
   *
   * @param params - Object containing insert parameters
   * @param params.key - The unique identifier for the new item. This is an optimistic ID that will be replaced by a server-generated ID when the operation syncs.
   * @param params.data - The complete data for the new item. Must conform to the collection's schema if one is defined.
   * @param params.metadata - Optional metadata to associate with the insert. This can be used for tracking purposes.
   * @returns A Transaction object representing the insert operation
   * @throws {SchemaValidationError} If the data fails schema validation
   * @example
   * ```typescript
   * // Insert a new todo item
   * collection.insert({
   *   key: Date.now().toString(),
   *   data: { text: "Buy milk", completed: false },
   * });
   * ```
   */
  insert = ({ key, data, metadata }: InsertParams<T>) => {
    // Validate the data against the schema if one exists
    const validatedData = this.validateData(data, `insert`)

    const mutation: PendingMutation = {
      mutationId: crypto.randomUUID(),
      original: {},
      modified: validatedData as Record<string, unknown>,
      changes: validatedData as Record<string, unknown>,
      key,
      metadata,
      syncMetadata: this.config.sync.getSyncMetadata?.() || {},
      type: `insert`,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const transaction = this.transactionManager.applyTransaction([mutation], {
      type: `ordered`,
    })

    // After insertion, associate the object with its key in the WeakMap
    const object = this.value.get(key)
    if (object && typeof object === `object`) {
      this.objectKeyMap.set(object as object, key)
    }

    return transaction
  }

  /**
   * Deletes an item from the collection
   *
   * @param params - Object containing delete parameters
   * @param params.key - The unique identifier for the item to delete, or the item object itself
   * @param params.metadata - Optional metadata to associate with the delete
   * @returns A Transaction object representing the delete operation
   */
  delete = ({ key: keyOrObject, metadata }: DeleteParams) => {
    // Determine the key - either directly provided or from the WeakMap
    let key: string
    if (typeof keyOrObject === `object` && keyOrObject !== null) {
      const objectKey = this.objectKeyMap.get(keyOrObject as object)
      if (!objectKey) {
        throw new Error(`Object not found in collection`)
      }
      key = objectKey
    } else {
      key = keyOrObject as string
    }

    const mutation: PendingMutation = {
      mutationId: crypto.randomUUID(),
      original: (this.value.get(key) || {}) as Record<string, unknown>,
      modified: { _deleted: true },
      changes: { _deleted: true },
      key,
      metadata,
      syncMetadata: (this.syncedMetadata.state.get(key) || {}) as Record<
        string,
        unknown
      >,
      type: `delete`,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    return this.transactionManager.applyTransaction([mutation], {
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
