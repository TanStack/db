import {
  ShapeStream,
  isChangeMessage,
  isControlMessage,
} from "@electric-sql/client"
import { Store } from "@tanstack/store"
import DebugModule from "debug"
import {
  ExpectedNumberInAwaitTxIdError,
  StreamAbortedError,
  TimeoutWaitingForMatchError,
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

// Re-export for user convenience in custom match functions
export { isChangeMessage, isControlMessage } from "@electric-sql/client"

const debug = DebugModule.debug(`ts/db:electric`)

/**
 * Type representing a transaction ID in ElectricSQL
 */
export type Txid = number

/**
 * Custom match function type - receives stream messages and returns boolean
 * indicating if the mutation has been synchronized
 */
export type MatchFunction<T extends Row<unknown>> = (
  message: Message<T>
) => boolean

/**
 * Matching strategies for Electric synchronization
 * Handlers can return one of three strategies:
 * - Txid strategy: { txid: number | number[] }
 * - Custom match strategy: { matchFn: (message) => boolean, timeout?: number }
 * - Void strategy: { timeout?: number } (when neither txid nor matchFn provided)
 */
export type MatchingStrategy<T extends Row<unknown> = Row<unknown>> =
  | { txid: Txid | Array<Txid> }
  | { matchFn: MatchFunction<T>; timeout?: number }
  | { timeout?: number }

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
   * Can return different matching strategies for synchronization
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to a matching strategy
   * @example
   * // Basic Electric insert handler with txid matching (backward compatible)
   * onInsert: async ({ transaction }) => {
   *   const newItem = transaction.mutations[0].modified
   *   const result = await api.todos.create({
   *     data: newItem
   *   })
   *   return { txid: result.txid } // Txid strategy (backward compatible)
   * }
   *
   * @example
   * // Custom match function strategy
   * onInsert: async ({ transaction }) => {
   *   const newItem = transaction.mutations[0].modified
   *   await api.todos.create({ data: newItem })
   *   return {
   *     matchFn: (message) => {
   *       return isChangeMessage(message) &&
   *              message.headers.operation === 'insert' &&
   *              message.value.name === newItem.name
   *     },
   *     timeout: 5000 // Optional timeout in ms, defaults to 3000
   *   }
   * }
   *
   * @example
   * // Void strategy - always waits 3 seconds
   * onInsert: async ({ transaction }) => {
   *   const newItem = transaction.mutations[0].modified
   *   await api.todos.create({ data: newItem })
   *   return {} // Void strategy
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
   */
  onInsert?: (
    params: InsertMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<MatchingStrategy<ResolveType<TExplicit, TSchema, TFallback>>>

  /**
   * Optional asynchronous handler function called before an update operation
   * Can return different matching strategies for synchronization
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to a matching strategy
   * @example
   * // Basic Electric update handler with txid matching (backward compatible)
   * onUpdate: async ({ transaction }) => {
   *   const { original, changes } = transaction.mutations[0]
   *   const result = await api.todos.update({
   *     where: { id: original.id },
   *     data: changes
   *   })
   *   return { txid: result.txid } // Txid strategy (backward compatible)
   * }
   *
   * @example
   * // Custom match function strategy for updates
   * onUpdate: async ({ transaction }) => {
   *   const { original, changes } = transaction.mutations[0]
   *   await api.todos.update({ where: { id: original.id }, data: changes })
   *   return {
   *     matchFn: (message) => {
   *       return isChangeMessage(message) &&
   *              message.headers.operation === 'update' &&
   *              message.value.id === original.id
   *     }
   *   }
   * }
   *
   * @example
   * // Void strategy - always waits 3 seconds
   * onUpdate: async ({ transaction }) => {
   *   const { original, changes } = transaction.mutations[0]
   *   await api.todos.update({ where: { id: original.id }, data: changes })
   *   return {} // Void strategy
   * }
   */
  onUpdate?: (
    params: UpdateMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<MatchingStrategy<ResolveType<TExplicit, TSchema, TFallback>>>

  /**
   * Optional asynchronous handler function called before a delete operation
   * Can return different matching strategies for synchronization
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to a matching strategy
   * @example
   * // Basic Electric delete handler with txid matching (backward compatible)
   * onDelete: async ({ transaction }) => {
   *   const mutation = transaction.mutations[0]
   *   const result = await api.todos.delete({
   *     id: mutation.original.id
   *   })
   *   return { txid: result.txid } // Txid strategy (backward compatible)
   * }
   *
   * @example
   * // Custom match function strategy for deletes
   * onDelete: async ({ transaction }) => {
   *   const mutation = transaction.mutations[0]
   *   await api.todos.delete({ id: mutation.original.id })
   *   return {
   *     matchFn: (message) => {
   *       return isChangeMessage(message) &&
   *              message.headers.operation === 'delete' &&
   *              message.value.id === mutation.original.id
   *     }
   *   }
   * }
   *
   * @example
   * // Void strategy - always waits 3 seconds
   * onDelete: async ({ transaction }) => {
   *   const mutation = transaction.mutations[0]
   *   await api.todos.delete({ id: mutation.original.id })
   *   return {} // Void strategy
   * }
   */
  onDelete?: (
    params: DeleteMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<MatchingStrategy<ResolveType<TExplicit, TSchema, TFallback>>>
}

function isUpToDateMessage<T extends Row<unknown>>(
  message: Message<T>
): message is ControlMessage & { up_to_date: true } {
  return isControlMessage(message) && message.headers.control === `up-to-date`
}

function isMustRefetchMessage<T extends Row<unknown>>(
  message: Message<T>
): message is ControlMessage & { headers: { control: `must-refetch` } } {
  return isControlMessage(message) && message.headers.control === `must-refetch`
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
 * Type for the awaitMatch utility function
 */
export type AwaitMatchFn<T extends Row<unknown>> = (
  matchFn: MatchFunction<T>,
  timeout?: number
) => Promise<boolean>

/**
 * Electric collection utilities type
 */
export interface ElectricCollectionUtils<T extends Row<unknown> = Row<unknown>>
  extends UtilsRecord {
  awaitTxId: AwaitTxIdFn
  awaitMatch: AwaitMatchFn<T>
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
  const pendingMatches = new Store<
    Map<
      string,
      {
        matchFn: (
          message: Message<ResolveType<TExplicit, TSchema, TFallback>>
        ) => boolean
        resolve: (value: boolean) => void
        reject: (error: Error) => void
        timeoutId: ReturnType<typeof setTimeout>
        matched: boolean
      }
    >
  >(new Map())

  // Buffer messages since last up-to-date to handle race conditions
  const currentBatchMessages = new Store<
    Array<Message<ResolveType<TExplicit, TSchema, TFallback>>>
  >([])
  const sync = createElectricSync<ResolveType<TExplicit, TSchema, TFallback>>(
    config.shapeOptions,
    {
      seenTxids,
      pendingMatches,
      currentBatchMessages,
    }
  )

  /**
   * Wait for a specific transaction ID to be synced
   * @param txId The transaction ID to wait for as a number
   * @param timeout Optional timeout in milliseconds (defaults to 3000ms)
   * @returns Promise that resolves when the txId is synced
   */
  const awaitTxId: AwaitTxIdFn = async (
    txId: Txid,
    timeout: number = 3000
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

  /**
   * Wait for a custom match function to find a matching message
   * @param matchFn Function that returns true when a message matches
   * @param timeout Optional timeout in milliseconds (defaults to 3000ms)
   * @returns Promise that resolves when a matching message is found
   */
  const awaitMatch: AwaitMatchFn<
    ResolveType<TExplicit, TSchema, TFallback>
  > = async (
    matchFn: MatchFunction<ResolveType<TExplicit, TSchema, TFallback>>,
    timeout: number = 3000
  ): Promise<boolean> => {
    debug(`awaitMatch called with custom function`)

    return new Promise((resolve, reject) => {
      const matchId = Math.random().toString(36)

      const cleanupMatch = () => {
        pendingMatches.setState((current) => {
          const newMatches = new Map(current)
          newMatches.delete(matchId)
          return newMatches
        })
      }

      const onTimeout = () => {
        cleanupMatch()
        reject(new TimeoutWaitingForMatchError())
      }

      const timeoutId = setTimeout(onTimeout, timeout)

      // We need access to the stream messages to check against the match function
      // This will be handled by the sync configuration
      const checkMatch = (
        message: Message<ResolveType<TExplicit, TSchema, TFallback>>
      ) => {
        if (matchFn(message)) {
          debug(`awaitMatch found matching message, waiting for up-to-date`)
          // Mark as matched but don't resolve yet - wait for up-to-date
          pendingMatches.setState((current) => {
            const newMatches = new Map(current)
            const existing = newMatches.get(matchId)
            if (existing) {
              newMatches.set(matchId, { ...existing, matched: true })
            }
            return newMatches
          })
          return true
        }
        return false
      }

      // Check against current batch messages first to handle race conditions
      for (const message of currentBatchMessages.state) {
        if (checkMatch(message)) {
          debug(
            `awaitMatch found immediate match in current batch, waiting for up-to-date`
          )
          // Mark as matched and register for up-to-date resolution
          pendingMatches.setState((current) => {
            const newMatches = new Map(current)
            newMatches.set(matchId, {
              matchFn: checkMatch,
              resolve,
              reject,
              timeoutId,
              matched: true, // Already matched
            })
            return newMatches
          })
          return
        }
      }

      // Store the match function for the sync process to use
      // We'll add this to a pending matches store
      pendingMatches.setState((current) => {
        const newMatches = new Map(current)
        newMatches.set(matchId, {
          matchFn: checkMatch,
          resolve,
          reject,
          timeoutId,
          matched: false,
        })
        return newMatches
      })
    })
  }

  /**
   * Wait for a fixed timeout (void strategy)
   * @param timeout Timeout in milliseconds (defaults to 3000ms for void strategy)
   * @returns Promise that resolves after the timeout
   */
  const awaitVoid = async (timeout: number = 3000): Promise<boolean> => {
    debug(`awaitVoid called with timeout %dms`, timeout)
    return new Promise((resolve) => {
      setTimeout(() => {
        debug(`awaitVoid completed after %dms`, timeout)
        resolve(true)
      }, timeout)
    })
  }

  /**
   * Process matching strategy and wait for synchronization
   */
  const processMatchingStrategy = async (
    result: MatchingStrategy<ResolveType<TExplicit, TSchema, TFallback>>
  ): Promise<void> => {
    // Check for txid strategy (backward compatible)
    if (`txid` in result) {
      // Handle both single txid and array of txids
      if (Array.isArray(result.txid)) {
        await Promise.all(result.txid.map((id) => awaitTxId(id)))
      } else {
        await awaitTxId(result.txid)
      }
      return
    }

    // Check for custom match function strategy
    if (`matchFn` in result) {
      await awaitMatch(result.matchFn, result.timeout)
      return
    }

    // Void strategy with configurable timeout
    const timeout = result.timeout ?? 3000
    await awaitVoid(timeout)
  }

  // Create wrapper handlers for direct persistence operations that handle different matching strategies
  const wrappedOnInsert = config.onInsert
    ? async (
        params: InsertMutationFnParams<
          ResolveType<TExplicit, TSchema, TFallback>
        >
      ) => {
        const handlerResult = await config.onInsert!(params)
        await processMatchingStrategy(handlerResult)
        return handlerResult
      }
    : undefined

  const wrappedOnUpdate = config.onUpdate
    ? async (
        params: UpdateMutationFnParams<
          ResolveType<TExplicit, TSchema, TFallback>
        >
      ) => {
        const handlerResult = await config.onUpdate!(params)
        await processMatchingStrategy(handlerResult)
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
        await processMatchingStrategy(handlerResult)
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
      awaitMatch,
    } as ElectricCollectionUtils<ResolveType<TExplicit, TSchema, TFallback>>,
  }
}

/**
 * Internal function to create ElectricSQL sync configuration
 */
function createElectricSync<T extends Row<unknown>>(
  shapeOptions: ShapeStreamOptions<GetExtensions<T>>,
  options: {
    seenTxids: Store<Set<Txid>>
    pendingMatches: Store<
      Map<
        string,
        {
          matchFn: (message: Message<T>) => boolean
          resolve: (value: boolean) => void
          reject: (error: Error) => void
          timeoutId: ReturnType<typeof setTimeout>
          matched: boolean
        }
      >
    >
    currentBatchMessages: Store<Array<Message<T>>>
  }
): SyncConfig<T> {
  const { seenTxids, pendingMatches, currentBatchMessages } = options
  const MAX_BATCH_MESSAGES = 1000 // Safety limit for message buffer

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

  // Cleanup pending matches on abort
  abortController.signal.addEventListener(`abort`, () => {
    pendingMatches.setState((current) => {
      current.forEach((match) => {
        clearTimeout(match.timeoutId)
        match.reject(new StreamAbortedError())
      })
      return new Map() // Clear all pending matches
    })
  })

  let unsubscribeStream: () => void

  return {
    sync: (params: Parameters<SyncConfig<T>[`sync`]>[0]) => {
      const { begin, write, commit, markReady, truncate, collection } = params
      const stream = new ShapeStream({
        ...shapeOptions,
        signal: abortController.signal,
        onError: (errorParams) => {
          // Just immediately mark ready if there's an error to avoid blocking
          // apps waiting for `.preload()` to finish.
          // Note that Electric sends a 409 error on a `must-refetch` message, but the
          // ShapeStream handled this and it will not reach this handler, therefor
          // this markReady will not be triggers by a `must-refetch`.
          markReady()

          if (shapeOptions.onError) {
            return shapeOptions.onError(errorParams)
          } else {
            console.error(
              `An error occurred while syncing collection: ${collection.id}, \n` +
                `it has been marked as ready to avoid blocking apps waiting for '.preload()' to finish. \n` +
                `You can provide an 'onError' handler on the shapeOptions to handle this error, and this message will not be logged.`,
              errorParams
            )
          }

          return
        },
      })
      let transactionStarted = false
      const newTxids = new Set<Txid>()

      unsubscribeStream = stream.subscribe((messages: Array<Message<T>>) => {
        let hasUpToDate = false

        for (const message of messages) {
          // Add message to current batch buffer (for race condition handling)
          if (isChangeMessage(message)) {
            currentBatchMessages.setState((currentBuffer) => {
              const newBuffer = [...currentBuffer, message]
              // Limit buffer size for safety
              if (newBuffer.length > MAX_BATCH_MESSAGES) {
                newBuffer.splice(0, newBuffer.length - MAX_BATCH_MESSAGES)
              }
              return newBuffer
            })
          }

          // Check for txids in the message and add them to our store
          if (hasTxids(message)) {
            message.headers.txids?.forEach((txid) => newTxids.add(txid))
          }

          // Check pending matches against this message
          // Note: matchFn will mark matches internally, we don't resolve here
          const matchesToRemove: Array<string> = []
          pendingMatches.state.forEach((match, matchId) => {
            if (!match.matched) {
              try {
                match.matchFn(message)
              } catch (err) {
                // If matchFn throws, clean up and reject the promise
                clearTimeout(match.timeoutId)
                match.reject(
                  err instanceof Error ? err : new Error(String(err))
                )
                matchesToRemove.push(matchId)
                debug(`matchFn error: %o`, err)
              }
            }
          })

          // Remove matches that errored
          if (matchesToRemove.length > 0) {
            pendingMatches.setState((current) => {
              const newMatches = new Map(current)
              matchesToRemove.forEach((id) => newMatches.delete(id))
              return newMatches
            })
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
          } else if (isMustRefetchMessage(message)) {
            debug(
              `Received must-refetch message, starting transaction with truncate`
            )

            // Start a transaction and truncate the collection
            if (!transactionStarted) {
              begin()
              transactionStarted = true
            }

            truncate()

            // Reset hasUpToDate so we continue accumulating changes until next up-to-date
            hasUpToDate = false
          }
        }

        if (hasUpToDate) {
          // Clear the current batch buffer since we're now up-to-date
          currentBatchMessages.setState(() => [])

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

          // Resolve all matched pending matches on up-to-date
          const matchesToResolve: Array<string> = []
          pendingMatches.state.forEach((match, matchId) => {
            if (match.matched) {
              clearTimeout(match.timeoutId)
              match.resolve(true)
              matchesToResolve.push(matchId)
              debug(`awaitMatch resolved on up-to-date for match %s`, matchId)
            }
          })

          // Remove resolved matches
          if (matchesToResolve.length > 0) {
            pendingMatches.setState((current) => {
              const newMatches = new Map(current)
              matchesToResolve.forEach((id) => newMatches.delete(id))
              return newMatches
            })
          }
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
