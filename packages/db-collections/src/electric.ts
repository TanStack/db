import {
  ShapeStream,
  isChangeMessage,
  isControlMessage,
} from "@electric-sql/client"
import { Store } from "@tanstack/store"
import type {
  CollectionConfig,
  MutationFnParams,
  ResolveType,
  SyncConfig,
  UtilsRecord,
} from "@tanstack/db"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type {
  ControlMessage,
  Message,
  Row,
  ShapeStreamOptions,
} from "@electric-sql/client"

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
  TExplicit = unknown,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends Row<unknown> = Row<unknown>,
> {
  /**
   * Configuration options for the ElectricSQL ShapeStream
   */
  shapeOptions: ShapeStreamOptions

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
    params: MutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<{ txid: string } | undefined>

  /**
   * Optional asynchronous handler function called before an update operation
   * Must return an object containing a txid string
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to an object with txid
   */
  onUpdate?: (
    params: MutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<{ txid: string } | undefined>

  /**
   * Optional asynchronous handler function called before a delete operation
   * Must return an object containing a txid string
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to an object with txid
   */
  onDelete?: (
    params: MutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<{ txid: string } | undefined>
}

function isUpToDateMessage<T extends Row<unknown>>(
  message: Message<T>
): message is ControlMessage & { up_to_date: true } {
  return isControlMessage(message) && message.headers.control === `up-to-date`
}

// Check if a message contains txids in its headers
function hasTxids<T extends Row<unknown>>(
  message: Message<T>
): message is Message<T> & { headers: { txids?: Array<number> } } {
  return (
    `headers` in message &&
    `txids` in message.headers &&
    Array.isArray(message.headers.txids)
  )
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
  TExplicit = unknown,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends Row<unknown> = Row<unknown>,
>(config: ElectricCollectionConfig<TExplicit, TSchema, TFallback>) {
  const seenTxids = new Store<Set<string>>(new Set([`${Math.random()}`]))
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
    timeout = 30000
  ): Promise<boolean> => {
    const hasTxid = seenTxids.state.has(txId)
    if (hasTxid) return true

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        unsubscribe()
        reject(new Error(`Timeout waiting for txId: ${txId}`))
      }, timeout)

      const unsubscribe = seenTxids.subscribe(() => {
        if (seenTxids.state.has(txId)) {
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
        params: MutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
      ) => {
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
        params: MutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
      ) => {
        const handlerResult = await config.onUpdate!(params)
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
        params: MutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
      ) => {
        const handlerResult = await config.onDelete!(params)
        const txid = (handlerResult as { txid?: string }).txid

        if (!txid) {
          throw new Error(
            `Electric collection onDelete handler must return a txid`
          )
        }

        await awaitTxId(txid)
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
function createElectricSync<T extends object>(
  shapeOptions: ShapeStreamOptions,
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

  return {
    sync: (params: Parameters<SyncConfig<T>[`sync`]>[0]) => {
      const { begin, write, commit } = params
      const stream = new ShapeStream(shapeOptions)
      let transactionStarted = false
      let newTxids = new Set<string>()

      stream.subscribe((messages: Array<Message<Row>>) => {
        let hasUpToDate = false

        for (const message of messages) {
          // Check for txids in the message and add them to our store
          if (hasTxids(message) && message.headers.txids) {
            message.headers.txids.forEach((txid) => newTxids.add(String(txid)))
          }

          // Check if the message contains schema information
          if (isChangeMessage(message) && message.headers.schema) {
            // Store the schema for future use if it's a valid string
            if (typeof message.headers.schema === `string`) {
              const schema: string = message.headers.schema
              relationSchema.setState(() => schema)
            }
          }

          if (isChangeMessage(message)) {
            if (!transactionStarted) {
              begin()
              transactionStarted = true
            }

            const value = message.value as unknown as T

            // Include the primary key and relation info in the metadata
            const enhancedMetadata = {
              ...message.headers,
            }

            write({
              type: message.headers.operation,
              value,
              metadata: enhancedMetadata,
            })
          } else if (isUpToDateMessage(message)) {
            hasUpToDate = true
          }
        }

        if (hasUpToDate && transactionStarted) {
          commit()
          seenTxids.setState((currentTxids) => {
            const clonedSeen = new Set(currentTxids)
            newTxids.forEach((txid) => clonedSeen.add(String(txid)))

            newTxids = new Set()
            return clonedSeen
          })
          transactionStarted = false
        }
      })
    },
    // Expose the getSyncMetadata function
    getSyncMetadata,
  }
}
