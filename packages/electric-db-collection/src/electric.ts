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
  BaseCollectionConfig,
  CollectionConfig,
  DeleteMutationFn,
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

// The `InferSchemaOutput`, `InferSchemaInput`, `ResolveType` and `ResolveInput` are
// copied from the `@tanstack/db` package but we modified `InferSchemaOutput`
// and `InferSchemaInput` slightly to restrict the schema output to `Row<unknown>`
// This is needed in order for `GetExtensions` to be able to infer the parser
// extensions type from the schema.

type InferSchemaOutput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T> extends Row<unknown>
    ? StandardSchemaV1.InferOutput<T>
    : Record<string, unknown>
  : Record<string, unknown>

type InferSchemaInput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<T> extends Row<unknown>
    ? StandardSchemaV1.InferInput<T>
    : Record<string, unknown>
  : Record<string, unknown>

export type ResolveInput<
  TExplicit extends Row<unknown> = Row<unknown>,
  TSchema = never,
> = [TSchema] extends [never]
  ? TExplicit extends object
    ? TExplicit
    : Record<string, unknown>
  : TSchema extends StandardSchemaV1
    ? InferSchemaInput<TSchema>
    : TExplicit extends object
      ? TExplicit
      : Record<string, unknown>

export type ResolveType<
  TExplicit extends Row<unknown> = Row<unknown>,
  TSchema = never,
> = [TSchema] extends [never]
  ? TExplicit extends Row<unknown>
    ? TExplicit
    : Record<string, unknown>
  : TSchema extends StandardSchemaV1
    ? InferSchemaOutput<TSchema>
    : TExplicit extends Row<unknown>
      ? TExplicit
      : Record<string, unknown>

/**
 * Configuration interface for Electric collection options
 * @template TExplicit - The explicit type of items in the collection (second priority)
 * @template TSchema - The schema type for validation and type inference (highest priority)
 * @template TKey - The type of the key returned by getKey
 */
export interface ElectricCollectionConfig<
  TExplicit extends Row<unknown> = Row<unknown>,
  TKey extends string | number = string | number,
  TSchema = never,
> extends BaseCollectionConfig<TExplicit, TKey, TSchema> {
  /**
   * Configuration options for the ElectricSQL ShapeStream
   */
  shapeOptions: ShapeStreamOptions<
    GetExtensions<ResolveType<TExplicit, TSchema>>
  >
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
 * Electric collection utilities type
 */
export interface ElectricCollectionUtils extends UtilsRecord {
  awaitTxId: AwaitTxIdFn
}

/**
 * Creates Electric collection options for use with a standard Collection
 *
 * @template TExplicit - The explicit type of items in the collection (second priority)
 * @template TSchema - The schema type for validation and type inference (highest priority)
 * @template TKey - The type of the key returned by getKey
 * @param config - Configuration options for the Electric collection
 * @returns Collection options with utilities
 */
export function electricCollectionOptions<
  TExplicit extends Row<unknown> = Row<unknown>,
  TKey extends string | number = string | number,
  TSchema = never,
>(
  config: ElectricCollectionConfig<TExplicit, TKey, TSchema>
): CollectionConfig<
  ResolveType<TExplicit, TSchema>,
  TKey,
  TSchema,
  ResolveInput<TExplicit, TSchema>
> & { utils: ElectricCollectionUtils } {
  const seenTxids = new Store<Set<Txid>>(new Set([]))
  const sync = createElectricSync<ResolveType<TExplicit, TSchema>, TKey>(
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
        params: InsertMutationFnParams<ResolveType<TExplicit, TSchema>>
      ) => {
        // Runtime check (that doesn't follow type)

        const handlerResult = (await config.onInsert!(params as any)) ?? {}
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
        params: UpdateMutationFnParams<ResolveType<TExplicit, TSchema>>
      ) => {
        // Runtime check (that doesn't follow type)

        const handlerResult = (await config.onUpdate!(params as any)) ?? {}
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

  const wrappedOnDelete:
    | DeleteMutationFn<ResolveType<TExplicit, TSchema>>
    | undefined = config.onDelete
    ? async (
        params: DeleteMutationFnParams<ResolveType<TExplicit, TSchema>>
      ) => {
        const handlerResult = await config.onDelete!(params as any)
        const txid = (handlerResult as { txid?: Txid | Array<Txid> }).txid

        if (!txid) {
          throw new ElectricDeleteHandlerMustReturnTxIdError()
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
  } as CollectionConfig<
    ResolveType<TExplicit, TSchema>,
    TKey,
    TSchema,
    ResolveInput<TExplicit, TSchema>
  > & { utils: ElectricCollectionUtils }
}

/**
 * Internal function to create ElectricSQL sync configuration
 */
function createElectricSync<
  T extends Row<unknown>,
  TKey extends string | number,
>(
  shapeOptions: ShapeStreamOptions<GetExtensions<T>>,
  options: {
    seenTxids: Store<Set<Txid>>
  }
): SyncConfig<T, TKey> {
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
    sync: (params: Parameters<SyncConfig<T, TKey>[`sync`]>[0]) => {
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
