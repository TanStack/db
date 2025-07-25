import {
  ShapeStream,
  isChangeMessage,
  isControlMessage,
} from "@electric-sql/client"
import { Store } from "@tanstack/store"
import DebugModule from "debug"
import {
  ElectricDeleteHandlerMustReturnTxIdError,
  ElectricInsertHandlerMustReturnTxIdError,
  ElectricUpdateHandlerMustReturnTxIdError,
  ExpectedNumberInAwaitTxIdError,
  TimeoutWaitingForTxIdError,
} from "./errors"
import type {
  CollectionConfig,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from "@tanstack/db"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type {
  ControlMessage,
  GetExtensions,
  Message,
  Row,
  ShapeStreamOptions,
} from "@electric-sql/client"

const debug = DebugModule.debug(`ts/db:electric`)

/**
 * Type representing a transaction ID in ElectricSQL
 */
export type Txid = number

// The `InferSchemaOutput` and `ResolveType` are copied from the `@tanstack/db` package
// but we modified `InferSchemaOutput` slightly to restrict the schema output to `Row<unknown>`
// This is needed in order for `GetExtensions` to be able to infer the parser extensions type from the schema
type InferSchemaOutput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T> extends Row<unknown>
    ? StandardSchemaV1.InferOutput<T>
    : Record<string, unknown>
  : Record<string, unknown>

type ResolveType<
  TExplicit extends Row<unknown> = Row<unknown>,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = Record<string, unknown>,
> =
  unknown extends GetExtensions<TExplicit>
    ? [TSchema] extends [never]
      ? TFallback
      : InferSchemaOutput<TSchema>
    : TExplicit

/**
 * Configuration interface for Electric collection options
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 *
 * @remarks
 * Type resolution follows a priority order:
 * 1. If you provide an explicit type via generic parameter, it will be used
 * 2. If no explicit type is provided but a schema is, the schema's output type will be inferred
 * 3. If neither explicit type nor schema is provided, the fallback type will be used
 *
 * You should provide EITHER an explicit type OR a schema, but not both, as they would conflict.
 */
export interface ElectricCollectionConfig<
  TExplicit extends Row<unknown> = Row<unknown>,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends Row<unknown> = Row<unknown>,
> {
  /**
   * Configuration options for the ElectricSQL ShapeStream
   */
  shapeOptions: ShapeStreamOptions<
    GetExtensions<ResolveType<TExplicit, TSchema, TFallback>>
  >

  /**
   * All standard Collection configuration properties
   */
  id?: string
  schema?: TSchema
  getKey: CollectionConfig<ResolveType<TExplicit, TSchema, TFallback>>[`getKey`]
  sync?: CollectionConfig<ResolveType<TExplicit, TSchema, TFallback>>[`sync`]

  /**
   * Optional asynchronous handler function called before an insert operation
   * Must return an object containing a txid number or array of txids
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to an object with txid or txids
   * @example
   * // Basic Electric insert handler - MUST return { txid: number }
   * onInsert: async ({ transaction }) => {
   *   const newItem = transaction.mutations[0].modified
   *   const result = await api.todos.create({
   *     data: newItem
   *   })
   *   return { txid: result.txid } // Required for Electric sync matching
   * }
   *
   * @example
   * // Insert handler with multiple items - return array of txids
   * onInsert: async ({ transaction }) => {
   *   const items = transaction.mutations.map(m => m.modified)
   *   const results = await Promise.all(
   *     items.map(item => api.todos.create({ data: item }))
   *   )
   *   return { txid: results.map(r => r.txid) } // Array of txids
   * }
   *
   * @example
   * // Insert handler with error handling
   * onInsert: async ({ transaction }) => {
   *   try {
   *     const newItem = transaction.mutations[0].modified
   *     const result = await api.createTodo(newItem)
   *     return { txid: result.txid }
   *   } catch (error) {
   *     console.error('Insert failed:', error)
   *     throw error // This will cause the transaction to fail
   *   }
   * }
   *
   * @example
   * // Insert handler with batch operation - single txid
   * onInsert: async ({ transaction }) => {
   *   const items = transaction.mutations.map(m => m.modified)
   *   const result = await api.todos.createMany({
   *     data: items
   *   })
   *   return { txid: result.txid } // Single txid for batch operation
   * }
   */
  onInsert?: (
    params: InsertMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<{ txid: Txid | Array<Txid> }>

  /**
   * Optional asynchronous handler function called before an update operation
   * Must return an object containing a txid number or array of txids
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to an object with txid or txids
   * @example
   * // Basic Electric update handler - MUST return { txid: number }
   * onUpdate: async ({ transaction }) => {
   *   const { original, changes } = transaction.mutations[0]
   *   const result = await api.todos.update({
   *     where: { id: original.id },
   *     data: changes // Only the changed fields
   *   })
   *   return { txid: result.txid } // Required for Electric sync matching
   * }
   *
   * @example
   * // Update handler with multiple items - return array of txids
   * onUpdate: async ({ transaction }) => {
   *   const updates = await Promise.all(
   *     transaction.mutations.map(m =>
   *       api.todos.update({
   *         where: { id: m.original.id },
   *         data: m.changes
   *       })
   *     )
   *   )
   *   return { txid: updates.map(u => u.txid) } // Array of txids
   * }
   *
   * @example
   * // Update handler with optimistic rollback
   * onUpdate: async ({ transaction }) => {
   *   const mutation = transaction.mutations[0]
   *   try {
   *     const result = await api.updateTodo(mutation.original.id, mutation.changes)
   *     return { txid: result.txid }
   *   } catch (error) {
   *     // Transaction will automatically rollback optimistic changes
   *     console.error('Update failed, rolling back:', error)
   *     throw error
   *   }
   * }
   */
  onUpdate?: (
    params: UpdateMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<{ txid: Txid | Array<Txid> }>

  /**
   * Optional asynchronous handler function called before a delete operation
   * Must return an object containing a txid number or array of txids
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to an object with txid or txids
   * @example
   * // Basic Electric delete handler - MUST return { txid: number }
   * onDelete: async ({ transaction }) => {
   *   const mutation = transaction.mutations[0]
   *   const result = await api.todos.delete({
   *     id: mutation.original.id
   *   })
   *   return { txid: result.txid } // Required for Electric sync matching
   * }
   *
   * @example
   * // Delete handler with multiple items - return array of txids
   * onDelete: async ({ transaction }) => {
   *   const deletes = await Promise.all(
   *     transaction.mutations.map(m =>
   *       api.todos.delete({
   *         where: { id: m.key }
   *       })
   *     )
   *   )
   *   return { txid: deletes.map(d => d.txid) } // Array of txids
   * }
   *
   * @example
   * // Delete handler with batch operation - single txid
   * onDelete: async ({ transaction }) => {
   *   const idsToDelete = transaction.mutations.map(m => m.original.id)
   *   const result = await api.todos.deleteMany({
   *     ids: idsToDelete
   *   })
   *   return { txid: result.txid } // Single txid for batch operation
   * }
   *
   * @example
   * // Delete handler with optimistic rollback
   * onDelete: async ({ transaction }) => {
   *   const mutation = transaction.mutations[0]
   *   try {
   *     const result = await api.deleteTodo(mutation.original.id)
   *     return { txid: result.txid }
   *   } catch (error) {
   *     // Transaction will automatically rollback optimistic changes
   *     console.error('Delete failed, rolling back:', error)
   *     throw error
   *   }
   * }
   *
   */
  onDelete?: (
    params: DeleteMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<{ txid: Txid | Array<Txid> }>
}

function isUpToDateMessage<T extends Row<unknown>>(
  message: Message<T>
): message is ControlMessage & { up_to_date: true } {
  return isControlMessage(message) && message.headers.control === `up-to-date`
}

// Check if a message contains txids in its headers
function hasTxids<T extends Row<unknown>>(
  message: Message<T>
): message is Message<T> & { headers: { txids?: Array<Txid> } } {
  return `txids` in message.headers && Array.isArray(message.headers.txids)
}

/**
 * Type for the awaitTxId utility function
 */
export type AwaitTxIdFn = (txId: Txid, timeout?: number) => Promise<boolean>

/**
 * Electric collection utilities type
 */
export interface ElectricCollectionUtils extends UtilsRecord {
  awaitTxId: AwaitTxIdFn
}

/**
 * Creates Electric collection options for use with a standard Collection
 *
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 * @param config - Configuration options for the Electric collection
 * @returns Collection options with utilities
 */
export function electricCollectionOptions<
  TExplicit extends Row<unknown> = Row<unknown>,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends Row<unknown> = Row<unknown>,
>(config: ElectricCollectionConfig<TExplicit, TSchema, TFallback>) {
  const seenTxids = new Store<Set<Txid>>(new Set([]))
  const sync = createElectricSync<ResolveType<TExplicit, TSchema, TFallback>>(
    config.shapeOptions,
    {
      seenTxids,
    }
  )

  /**
   * Wait for a specific transaction ID to be synced
   * @param txId The transaction ID to wait for as a number
   * @param timeout Optional timeout in milliseconds (defaults to 30000ms)
   * @returns Promise that resolves when the txId is synced
   */
  const awaitTxId: AwaitTxIdFn = async (
    txId: Txid,
    timeout: number = 30000
  ): Promise<boolean> => {
    debug(`awaitTxId called with txid %d`, txId)
    if (typeof txId !== `number`) {
      throw new ExpectedNumberInAwaitTxIdError(typeof txId)
    }

    const hasTxid = seenTxids.state.has(txId)
    if (hasTxid) return true

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        unsubscribe()
        reject(new TimeoutWaitingForTxIdError(txId))
      }, timeout)

      const unsubscribe = seenTxids.subscribe(() => {
        if (seenTxids.state.has(txId)) {
          debug(`awaitTxId found match for txid %o`, txId)
          clearTimeout(timeoutId)
          unsubscribe()
          resolve(true)
        }
      })
    })
  }

  // Create wrapper handlers for direct persistence operations that handle txid awaiting
  const wrappedOnInsert = config.onInsert
    ? async (
        params: InsertMutationFnParams<
          ResolveType<TExplicit, TSchema, TFallback>
        >
      ) => {
        // Runtime check (that doesn't follow type)
        // eslint-disable-next-line
        const handlerResult = (await config.onInsert!(params)) ?? {}
        const txid = (handlerResult as { txid?: Txid | Array<Txid> }).txid

        if (!txid) {
          throw new ElectricInsertHandlerMustReturnTxIdError()
        }

        // Handle both single txid and array of txids
        if (Array.isArray(txid)) {
          await Promise.all(txid.map((id) => awaitTxId(id)))
        } else {
          await awaitTxId(txid)
        }

        return handlerResult
      }
    : undefined

  const wrappedOnUpdate = config.onUpdate
    ? async (
        params: UpdateMutationFnParams<
          ResolveType<TExplicit, TSchema, TFallback>
        >
      ) => {
        // Runtime check (that doesn't follow type)
        // eslint-disable-next-line
        const handlerResult = (await config.onUpdate!(params)) ?? {}
        const txid = (handlerResult as { txid?: Txid | Array<Txid> }).txid

        if (!txid) {
          throw new ElectricUpdateHandlerMustReturnTxIdError()
        }

        // Handle both single txid and array of txids
        if (Array.isArray(txid)) {
          await Promise.all(txid.map((id) => awaitTxId(id)))
        } else {
          await awaitTxId(txid)
        }

        return handlerResult
      }
    : undefined

  const wrappedOnDelete = config.onDelete
    ? async (
        params: DeleteMutationFnParams<
          ResolveType<TExplicit, TSchema, TFallback>
        >
      ) => {
        const handlerResult = await config.onDelete!(params)
        if (!handlerResult.txid) {
          throw new ElectricDeleteHandlerMustReturnTxIdError()
        }

        // Handle both single txid and array of txids
        if (Array.isArray(handlerResult.txid)) {
          await Promise.all(handlerResult.txid.map((id) => awaitTxId(id)))
        } else {
          await awaitTxId(handlerResult.txid)
        }

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

  return {
    ...restConfig,
    sync,
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils: {
      awaitTxId,
    },
  }
}

/**
 * Internal function to create ElectricSQL sync configuration
 */
function createElectricSync<T extends Row<unknown>>(
  shapeOptions: ShapeStreamOptions<GetExtensions<T>>,
  options: {
    seenTxids: Store<Set<Txid>>
  }
): SyncConfig<T> {
  const { seenTxids } = options

  // Store for the relation schema information
  const relationSchema = new Store<string | undefined>(undefined)

  /**
   * Get the sync metadata for insert operations
   * @returns Record containing relation information
   */
  const getSyncMetadata = (): Record<string, unknown> => {
    // Use the stored schema if available, otherwise default to 'public'
    const schema = relationSchema.state || `public`

    return {
      relation: shapeOptions.params?.table
        ? [schema, shapeOptions.params.table]
        : undefined,
    }
  }

  // Abort controller for the stream - wraps the signal if provided
  const abortController = new AbortController()
  if (shapeOptions.signal) {
    shapeOptions.signal.addEventListener(`abort`, () => {
      abortController.abort()
    })
    if (shapeOptions.signal.aborted) {
      abortController.abort()
    }
  }

  let unsubscribeStream: () => void

  return {
    sync: (params: Parameters<SyncConfig<T>[`sync`]>[0]) => {
      const { begin, write, commit, markReady } = params
      const stream = new ShapeStream({
        ...shapeOptions,
        signal: abortController.signal,
        onError: (errorParams) => {
          // Just immediately mark ready if there's an error to avoid blocking
          // apps waiting for `.preload()` to finish.
          markReady()

          if (shapeOptions.onError) {
            return shapeOptions.onError(errorParams)
          }

          return
        },
      })
      let transactionStarted = false
      const newTxids = new Set<Txid>()

      unsubscribeStream = stream.subscribe((messages: Array<Message<T>>) => {
        let hasUpToDate = false

        for (const message of messages) {
          // Check for txids in the message and add them to our store
          if (hasTxids(message)) {
            message.headers.txids?.forEach((txid) => newTxids.add(txid))
          }

          if (isChangeMessage(message)) {
            // Check if the message contains schema information
            const schema = message.headers.schema
            if (schema && typeof schema === `string`) {
              // Store the schema for future use if it's a valid string
              relationSchema.setState(() => schema)
            }

            if (!transactionStarted) {
              begin()
              transactionStarted = true
            }

            write({
              type: message.headers.operation,
              value: message.value,
              // Include the primary key and relation info in the metadata
              metadata: {
                ...message.headers,
              },
            })
          } else if (isUpToDateMessage(message)) {
            hasUpToDate = true
          }
        }

        if (hasUpToDate) {
          // Commit transaction if one was started
          if (transactionStarted) {
            commit()
            transactionStarted = false
          }

          // Mark the collection as ready now that sync is up to date
          markReady()

          // Always commit txids when we receive up-to-date, regardless of transaction state
          seenTxids.setState((currentTxids) => {
            const clonedSeen = new Set<Txid>(currentTxids)
            if (newTxids.size > 0) {
              debug(`new txids synced from pg %O`, Array.from(newTxids))
            }
            newTxids.forEach((txid) => clonedSeen.add(txid))
            newTxids.clear()
            return clonedSeen
          })
        }
      })

      // Return the unsubscribe function
      return () => {
        // Unsubscribe from the stream
        unsubscribeStream()
        // Abort the abort controller to stop the stream
        abortController.abort()
      }
    },
    // Expose the getSyncMetadata function
    getSyncMetadata,
  }
}
