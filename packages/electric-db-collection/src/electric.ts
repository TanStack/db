import {
  ShapeStream,
  isChangeMessage,
  isControlMessage,
  isVisibleInSnapshot,
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
  DeleteMutationFnParams,
  Fn,
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
  PostgresSnapshot,
  Row,
  ShapeStreamOptions,
} from "@electric-sql/client"

const debug = DebugModule.debug(`ts/db:electric`)

/**
 * Type representing a transaction ID in ElectricSQL
 */
export type Txid = number

/**
 * Type representing the result of an insert, update, or delete handler
 */
type MaybeTxId =
  | {
      txid?: Txid | Array<Txid>
    }
  | undefined
  | null

/**
 * Type representing a snapshot end message
 */
type SnapshotEndMessage = ControlMessage & {
  headers: { control: `snapshot-end` }
}

// The `InferSchemaOutput` and `ResolveType` are copied from the `@tanstack/db` package
// but we modified `InferSchemaOutput` slightly to restrict the schema output to `Row<unknown>`
// This is needed in order for `GetExtensions` to be able to infer the parser extensions type from the schema
type InferSchemaOutput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T> extends Row<unknown>
    ? StandardSchemaV1.InferOutput<T>
    : Record<string, unknown>
  : Record<string, unknown>

/**
 * Configuration interface for Electric collection options
 * @template T - The type of items in the collection
 * @template TSchema - The schema type for validation
 */
export interface ElectricCollectionConfig<
  T extends Row<unknown> = Row<unknown>,
  TSchema extends StandardSchemaV1 = never,
> extends BaseCollectionConfig<
    T,
    string | number,
    TSchema,
    Record<string, Fn>,
    { txid: Txid | Array<Txid> }
  > {
  /**
   * Configuration options for the ElectricSQL ShapeStream
   */
  shapeOptions: ShapeStreamOptions<GetExtensions<T>>
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

function isSnapshotEndMessage<T extends Row<unknown>>(
  message: Message<T>
): message is SnapshotEndMessage {
  return isControlMessage(message) && message.headers.control === `snapshot-end`
}

function parseSnapshotMessage(message: SnapshotEndMessage): PostgresSnapshot {
  return {
    xmin: message.headers.xmin,
    xmax: message.headers.xmax,
    xip_list: message.headers.xip_list,
  }
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
 * @template T - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 * @param config - Configuration options for the Electric collection
 * @returns Collection options with utilities
 */

// Overload for when schema is provided
export function electricCollectionOptions<T extends StandardSchemaV1>(
  config: ElectricCollectionConfig<InferSchemaOutput<T>, T> & {
    schema: T
  }
): CollectionConfig<InferSchemaOutput<T>, string | number, T> & {
  id?: string
  utils: ElectricCollectionUtils
  schema: T
}

// Overload for when no schema is provided
export function electricCollectionOptions<T extends Row<unknown>>(
  config: ElectricCollectionConfig<T> & {
    schema?: never // prohibit schema
  }
): CollectionConfig<T, string | number> & {
  id?: string
  utils: ElectricCollectionUtils
  schema?: never // no schema in the result
}

export function electricCollectionOptions(
  config: ElectricCollectionConfig<any, any>
): CollectionConfig<any, string | number, any> & {
  id?: string
  utils: ElectricCollectionUtils
  schema?: any
} {
  const seenTxids = new Store<Set<Txid>>(new Set([]))
  const seenSnapshots = new Store<Array<PostgresSnapshot>>([])
  const sync = createElectricSync<any>(config.shapeOptions, {
    seenTxids,
    seenSnapshots,
  })

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

    // First check if the txid is in the seenTxids store
    const hasTxid = seenTxids.state.has(txId)
    if (hasTxid) return true

    // Then check if the txid is in any of the seen snapshots
    const hasSnapshot = seenSnapshots.state.some((snapshot) =>
      isVisibleInSnapshot(txId, snapshot)
    )
    if (hasSnapshot) return true

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        unsubscribeSeenTxids()
        unsubscribeSeenSnapshots()
        reject(new TimeoutWaitingForTxIdError(txId))
      }, timeout)

      const unsubscribeSeenTxids = seenTxids.subscribe(() => {
        if (seenTxids.state.has(txId)) {
          debug(`awaitTxId found match for txid %o`, txId)
          clearTimeout(timeoutId)
          unsubscribeSeenTxids()
          unsubscribeSeenSnapshots()
          resolve(true)
        }
      })

      const unsubscribeSeenSnapshots = seenSnapshots.subscribe(() => {
        const visibleSnapshot = seenSnapshots.state.find((snapshot) =>
          isVisibleInSnapshot(txId, snapshot)
        )
        if (visibleSnapshot) {
          debug(
            `awaitTxId found match for txid %o in snapshot %o`,
            txId,
            visibleSnapshot
          )
          clearTimeout(timeoutId)
          unsubscribeSeenSnapshots()
          unsubscribeSeenTxids()
          resolve(true)
        }
      })
    })
  }

  // Create wrapper handlers for direct persistence operations that handle txid awaiting
  const wrappedOnInsert = config.onInsert
    ? async (params: InsertMutationFnParams<any>) => {
        // Runtime check (that doesn't follow type)

        const handlerResult =
          ((await config.onInsert!(params)) as MaybeTxId) ?? {}
        const txid = handlerResult.txid

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
    ? async (params: UpdateMutationFnParams<any>) => {
        // Runtime check (that doesn't follow type)

        const handlerResult =
          ((await config.onUpdate!(params)) as MaybeTxId) ?? {}
        const txid = handlerResult.txid

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
    ? async (params: DeleteMutationFnParams<any>) => {
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
    seenSnapshots: Store<Array<PostgresSnapshot>>
  }
): SyncConfig<T> {
  const { seenTxids } = options
  const { seenSnapshots } = options

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

  let unsubscribeStream: () => void

  return {
    sync: (params: Parameters<SyncConfig<T>[`sync`]>[0]) => {
      const { begin, write, commit, markReady, truncate, collection } = params

      // Abort controller for the stream - wraps the signal if provided
      const abortController = new AbortController()

      if (shapeOptions.signal) {
        shapeOptions.signal.addEventListener(
          `abort`,
          () => {
            abortController.abort()
          },
          {
            once: true,
          }
        )
        if (shapeOptions.signal.aborted) {
          abortController.abort()
        }
      }

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
      const newSnapshots: Array<PostgresSnapshot> = []

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
          } else if (isSnapshotEndMessage(message)) {
            newSnapshots.push(parseSnapshotMessage(message))
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

          // Always commit snapshots when we receive up-to-date, regardless of transaction state
          seenSnapshots.setState((currentSnapshots) => {
            const seen = [...currentSnapshots, ...newSnapshots]
            newSnapshots.forEach((snapshot) =>
              debug(`new snapshot synced from pg %o`, snapshot)
            )
            newSnapshots.length = 0
            return seen
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
