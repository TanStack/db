import {
  ShapeStream,
  isChangeMessage,
  isControlMessage,
} from "@electric-sql/client"
import { Store } from "@tanstack/store"
import DebugModule from "debug"
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
   * Must return an object containing a txid string
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to an object with txid
   */
  onInsert?: (
    params: InsertMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<{ txid: string }>

  /**
   * Optional asynchronous handler function called before an update operation
   * Must return an object containing a txid string
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to an object with txid
   */
  onUpdate?: (
    params: UpdateMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<{ txid: string }>

  /**
   * Optional asynchronous handler function called before a delete operation
   * Must return an object containing a txid string
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to an object with txid
   */
  onDelete?: (
    params: DeleteMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<{ txid: string }>
}

function isUpToDateMessage<T extends Row<unknown>>(
  message: Message<T>
): message is ControlMessage & { up_to_date: true } {
  return isControlMessage(message) && message.headers.control === `up-to-date`
}

// Check if a message contains txids in its headers
function hasTxids<T extends Row<unknown>>(
  message: Message<T>
): message is Message<T> & { headers: { txids?: Array<string> } } {
  return `txids` in message.headers && Array.isArray(message.headers.txids)
}

/**
 * Type for the awaitTxId utility function
 */
export type AwaitTxIdFn = (txId: string, timeout?: number) => Promise<boolean>

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
  const seenTxids = new Store<Set<string>>(new Set([]))
  const sync = createElectricSync<ResolveType<TExplicit, TSchema, TFallback>>(
    config.shapeOptions,
    {
      seenTxids,
    }
  )

  /**
   * Wait for a specific transaction ID to be synced
   * @param txId The transaction ID to wait for as a string
   * @param timeout Optional timeout in milliseconds (defaults to 30000ms)
   * @returns Promise that resolves when the txId is synced
   */
  const awaitTxId: AwaitTxIdFn = async (
    txId: string,
    timeout: number = 30000
  ): Promise<boolean> => {
    debug(`awaitTxId called with txid %o`, txId)
    if (typeof txId !== `string`) {
      throw new TypeError(
        `Expected string in awaitTxId, received ${typeof txId}`
      )
    }
    if (!/^\d+$/.test(txId)) {
      throw new Error(`txId must contain only numbers`)
    }

    const hasTxid = seenTxids.state.has(txId)
    if (hasTxid) return true

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        unsubscribe()
        reject(new Error(`Timeout waiting for txId: ${txId}`))
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
        const txid = (handlerResult as { txid?: string }).txid

        if (!txid) {
          throw new Error(
            `Electric collection onInsert handler must return a txid`
          )
        }

        await awaitTxId(txid)
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
        const txid = (handlerResult as { txid?: string }).txid

        if (!txid) {
          throw new Error(
            `Electric collection onUpdate handler must return a txid`
          )
        }

        await awaitTxId(txid)
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
          throw new Error(
            `Electric collection onDelete handler must return a txid`
          )
        }

        await awaitTxId(handlerResult.txid)
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
    seenTxids: Store<Set<string>>
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
      const { begin, write, commit } = params
      const stream = new ShapeStream({
        ...shapeOptions,
        signal: abortController.signal,
      })
      let transactionStarted = false
      const newTxids = new Set<string>()

      unsubscribeStream = stream.subscribe((messages: Array<Message<T>>) => {
        let hasUpToDate = false

        for (const message of messages) {
          // Check for txids in the message and add them to our store
          if (hasTxids(message)) {
            message.headers.txids?.forEach((txid) => newTxids.add(String(txid)))
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
          } else {
            // If the shape is empty, do an empty commit to move the collection status
            // to ready.
            begin()
            commit()
          }

          // Always commit txids when we receive up-to-date, regardless of transaction state
          seenTxids.setState((currentTxids) => {
            const clonedSeen = new Set<string>(currentTxids)
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
