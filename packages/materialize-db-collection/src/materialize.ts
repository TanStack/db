import { Store } from "@tanstack/store"
import DebugModule from "debug"
import { collectionsStore } from "@tanstack/db"
import type {
  CollectionConfig,
  CollectionImpl,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  ResolveType,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from "@tanstack/db"
import type { StandardSchemaV1 } from "@standard-schema/spec"

const debug = DebugModule.debug(`ts/db:materialize`)

/**
 * Type representing a Log Sequence Number (LSN) in Materialize
 */
export type LSN = string

/**
 * Configuration interface for Materialize collection options
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 */
export interface MaterializeCollectionConfig<
  TExplicit extends object = Record<string, unknown>,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = Record<string, unknown>,
> {
  /**
   * WebSocket endpoint URL for the Materialize proxy
   * This should be a specific endpoint like `/api/todos-ws` that handles
   * the Materialize subscription and forwards data to the client
   */
  websocketUrl: string

  /**
   * All standard Collection configuration properties
   */
  id?: string
  schema?: TSchema
  getKey: CollectionConfig<
    ResolveType<TExplicit, TSchema, TFallback>,
    string | number
  >[`getKey`]
  sync?: CollectionConfig<
    ResolveType<TExplicit, TSchema, TFallback>,
    string | number
  >[`sync`]

  /**
   * Whether to start syncing immediately when the collection is created
   * Defaults to false
   */
  startSync?: boolean

  /**
   * Optional field parsers for converting server data to client format
   * Similar to TrailBase's parse option
   * @example
   * parse: {
   *   created_at: (ts: string) => new Date(parseFloat(ts)),
   *   updated_at: (ts: string) => new Date(parseFloat(ts))
   * }
   */
  parse?: Record<string, (value: any) => any>

  /**
   * Optional field serializers for converting client data to server format
   * Similar to TrailBase's serialize option
   * @example
   * serialize: {
   *   created_at: (date: Date) => date.valueOf().toString(),
   *   updated_at: (date: Date) => date.valueOf().toString()
   * }
   */
  serialize?: Record<string, (value: any) => any>

  /**
   * Optional asynchronous handler function called before an insert operation
   * Should get LSN before and after the transaction for sync tracking
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to result with beforeLSN and afterLSN for sync tracking
   * @example
   * // Materialize insert handler with LSN tracking
   * onInsert: async ({ transaction, collection }) => {
   *   const beforeLSN = await collection.utils.getCurrentLSN()
   *   const newItem = transaction.mutations[0].modified
   *   const result = await api.todos.create({ data: newItem })
   *   const afterLSN = await api.getCurrentLSN() // Get LSN after write
   *   return { beforeLSN, afterLSN }
   * }
   */
  onInsert?: (
    params: InsertMutationFnParams<
      ResolveType<TExplicit, TSchema, TFallback>,
      string | number
    >
  ) => Promise<{
    beforeLSN: LSN
    afterLSN: LSN
  }>

  /**
   * Optional asynchronous handler function called before an update operation
   * Should get LSN before and after the transaction for sync tracking
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to result with beforeLSN and afterLSN for sync tracking
   */
  onUpdate?: (
    params: UpdateMutationFnParams<
      ResolveType<TExplicit, TSchema, TFallback>,
      string | number
    >
  ) => Promise<{
    beforeLSN: LSN
    afterLSN: LSN
  }>

  /**
   * Optional asynchronous handler function called before a delete operation
   * Should get LSN before and after the transaction for sync tracking
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to result with beforeLSN and afterLSN for sync tracking
   */
  onDelete?: (
    params: DeleteMutationFnParams<
      ResolveType<TExplicit, TSchema, TFallback>,
      string | number
    >
  ) => Promise<{
    beforeLSN: LSN
    afterLSN: LSN
  }>
}

/**
 * Message types received from the Materialize proxy
 */
export interface MaterializeProxyMessage<T = any> {
  type: `data` | `lsn`
  mz_timestamp?: number
  mz_progressed?: boolean
  mz_diff?: string
  row?: T
  value?: LSN // For LSN messages
}

/**
 * LSN sync tracking state
 */
export interface LSNSyncTracker {
  currentLSN: LSN | null
  pendingSyncs: Map<
    string,
    {
      beforeLSN: LSN
      afterLSN: LSN
      resolve: () => void
      reject: (error: Error) => void
      timeout: NodeJS.Timeout
    }
  >
}

/**
 * Connection state for Materialize WebSocket
 */
export type ConnectionState =
  | `connecting`
  | `connected`
  | `disconnected`
  | `error`

/**
 * Type for the awaitSync utility function
 */
export type AwaitSyncFn = (
  beforeLSN: LSN,
  afterLSN: LSN,
  timeout?: number
) => Promise<boolean>

/**
 * Materialize collection utilities type
 */
export interface MaterializeCollectionUtils extends UtilsRecord {
  /** Disconnect from Materialize proxy */
  disconnect: () => void
  /** Manual refresh of connection */
  refresh: () => Promise<void>
  /** Check connection status */
  isConnected: () => boolean
  /** Get current LSN */
  getCurrentLSN: () => LSN | null
  /** Wait for sync confirmation based on LSN tracking */
  awaitSync: AwaitSyncFn
}

/**
 * Creates a sync configuration for Materialize real-time data synchronization
 */
function createMaterializeSync<T extends object = Record<string, unknown>>(
  websocketUrl: string,
  parse?: Record<string, (value: any) => any>,
  getKey?: Record<string, (value: any) => any>
): SyncConfig<T, string | number> & { utils: MaterializeCollectionUtils } {
  let ws: WebSocket | null = null
  const connectionState = new Store<ConnectionState>(`disconnected`)
  const lsnTracker = new Store<LSNSyncTracker>({
    currentLSN: null,
    pendingSyncs: new Map(),
  })

  const disconnect = () => {
    if (ws) {
      ws.close()
      ws = null
      connectionState.setState(`disconnected`)
    }

    // Clean up pending syncs
    const tracker = lsnTracker.state
    tracker.pendingSyncs.forEach((sync) => {
      clearTimeout(sync.timeout)
      sync.reject(new Error(`Connection closed`))
    })
    lsnTracker.setState({
      ...tracker,
      pendingSyncs: new Map(),
    })
  }

  const isConnected = () => connectionState.state === `connected`

  const getCurrentLSN = () => lsnTracker.state.currentLSN

  let begin: (() => void) | null = null
  let write: ((message: any) => void) | null = null
  let commit: (() => void) | null = null
  let markReady: (() => void) | null = null
  let collection: CollectionImpl | null = null

  const refresh = async (): Promise<void> => {
    if (!isConnected()) {
      throw new Error(`Not connected to Materialize proxy`)
    }
    // For refresh, we could send a specific message to the proxy if needed
    // For now, just ensure connection is alive
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Could ping the server or request fresh data
      return Promise.resolve()
    }
    throw new Error(`WebSocket is not in a ready state`)
  }

  const awaitSync: AwaitSyncFn = async (
    beforeLSN: LSN,
    afterLSN: LSN,
    timeout: number = 5000
  ): Promise<boolean> => {
    debug(
      `awaitSync called with beforeLSN: %s, afterLSN: %s`,
      beforeLSN,
      afterLSN
    )

    const currentLSN = getCurrentLSN()

    // If we don't have an LSN yet, wait for one
    if (!currentLSN) {
      debug(`No current LSN, waiting for initial LSN`)
    }

    // Check if we've already seen an LSN greater than beforeLSN
    if (currentLSN && currentLSN > beforeLSN) {
      debug(
        `Current LSN %s > beforeLSN %s, waiting for afterLSN`,
        currentLSN,
        beforeLSN
      )

      // Wait additional time to see if afterLSN comes through
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const finalLSN = getCurrentLSN()
      if (finalLSN && finalLSN >= afterLSN) {
        debug(`Found afterLSN %s, sync confirmed`, afterLSN)
        return true
      }
    }

    return new Promise((resolve, reject) => {
      const syncId = `${beforeLSN}-${afterLSN}-${Date.now()}`

      const timeoutId = setTimeout(() => {
        const tracker = lsnTracker.state
        const sync = tracker.pendingSyncs.get(syncId)
        if (sync) {
          tracker.pendingSyncs.delete(syncId)
          lsnTracker.setState({ ...tracker })
          reject(
            new Error(
              `Timeout waiting for sync confirmation. beforeLSN: ${beforeLSN}, afterLSN: ${afterLSN}`
            )
          )
        }
      }, timeout)

      const tracker = lsnTracker.state
      tracker.pendingSyncs.set(syncId, {
        beforeLSN,
        afterLSN,
        resolve: () => resolve(true),
        reject,
        timeout: timeoutId,
      })
      lsnTracker.setState({ ...tracker })
    })
  }

  const connect = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (ws) {
        ws.close()
      }

      connectionState.setState(`connecting`)

      // Create WebSocket based on environment
      if (typeof window !== `undefined`) {
        // Browser environment
        ws = new WebSocket(websocketUrl)
      } else {
        // Node.js environment - this should not happen in the browser build
        // But if it does, we'll create a stub that will fail gracefully
        throw new Error(
          `Materialize collection requires browser WebSocket API. Server-side usage is not currently supported.`
        )
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout`))
        disconnect()
      }, 10000)

      const handleOpen = () => {
        clearTimeout(timeout)
        connectionState.setState(`connected`)
        debug(`Connected to Materialize proxy at %s`, websocketUrl)

        if (markReady) {
          markReady()
        }
        resolve()
      }

      const handleMessage = (event: any) => {
        const data = typeof event === `string` ? event : event.data
        try {
          const msg = JSON.parse(data.toString()) as MaterializeProxyMessage
          debug(`Received message: %o`, msg)

          if (msg.type === `lsn` && msg.value) {
            // Update current LSN
            const newLSN = msg.value
            const tracker = lsnTracker.state
            tracker.currentLSN = newLSN

            debug(`Updated LSN to: %s`, newLSN)

            // Check pending syncs
            tracker.pendingSyncs.forEach((sync, syncId) => {
              if (newLSN > sync.beforeLSN) {
                debug(
                  `LSN %s > beforeLSN %s for sync %s`,
                  newLSN,
                  sync.beforeLSN,
                  syncId
                )

                // Wait a bit more to see if afterLSN comes through
                setTimeout(() => {
                  const currentTracker = lsnTracker.state
                  const currentLSN = currentTracker.currentLSN

                  if (currentLSN && currentLSN >= sync.afterLSN) {
                    debug(
                      `Found afterLSN %s, confirming sync %s`,
                      sync.afterLSN,
                      syncId
                    )
                    clearTimeout(sync.timeout)
                    sync.resolve()
                    currentTracker.pendingSyncs.delete(syncId)
                    lsnTracker.setState({ ...currentTracker })
                  }
                }, 1000)
              }
            })

            lsnTracker.setState({ ...tracker })
            return
          }

          if (msg.type === `data` && msg.row && begin && write && commit) {
            // Handle data messages from the proxy
            begin()

            // Apply parse transformations to convert server data to client format
            let parsedRow = msg.row
            if (parse) {
              parsedRow = { ...msg.row }
              for (const [field, parser] of Object.entries(parse)) {
                if (parsedRow[field] !== undefined) {
                  parsedRow[field] = parser(parsedRow[field])
                }
              }
            }

            console.log({ parsedRow })

            // Determine operation type from mz_diff
            let operationType: `insert` | `update` | `delete` = `insert`
            console.log({ msg })
            if (msg.mz_diff !== undefined) {
              operationType =
                msg.mz_diff === `-1`
                  ? `delete`
                  : msg.mz_diff === `1` && collection.has(getKey(parsedRow))
                    ? `update`
                    : `insert`
            }

            write({
              type: operationType,
              value: parsedRow,
              metadata: {
                mz_timestamp: msg.mz_timestamp,
                mz_diff: msg.mz_diff,
              },
            })

            commit()
          }
        } catch (error) {
          debug(`Error parsing message: %o`, error)
        }
      }

      const handleError = (error: any) => {
        clearTimeout(timeout)
        debug(`WebSocket error: %o`, error)
        connectionState.setState(`error`)
        reject(error)
      }

      const handleClose = () => {
        debug(`WebSocket connection closed`)
        connectionState.setState(`disconnected`)
      }

      // Set up event listeners
      if (!ws) {
        reject(new Error(`Failed to create WebSocket connection`))
        return
      }

      // Browser WebSocket event listeners
      ws.addEventListener(`open`, handleOpen)
      ws.addEventListener(`message`, handleMessage)
      ws.addEventListener(`error`, handleError)
      ws.addEventListener(`close`, handleClose)
    })
  }

  const sync: SyncConfig<T, string | number>[`sync`] = async (params) => {
    begin = params.begin
    write = params.write
    commit = params.commit
    markReady = params.markReady
    collection = params.collection

    await connect()
  }

  const utils: MaterializeCollectionUtils = {
    disconnect,
    refresh,
    isConnected,
    getCurrentLSN,
    awaitSync,
  }

  return { sync, utils }
}

/**
 * Creates Materialize collection options for use with a standard Collection
 *
 * @template T - The type of items in the collection
 * @template TKey - The type of the collection key
 * @template TSchema - The schema type for validation and type inference
 * @param config - Configuration options for the Materialize collection
 * @returns Collection options with utilities
 */
export function materializeCollectionOptions<
  TExplicit extends object = Record<string, unknown>,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = Record<string, unknown>,
>(config: MaterializeCollectionConfig<TExplicit, TSchema, TFallback>) {
  const { utils, sync } = createMaterializeSync<
    ResolveType<TExplicit, TSchema, TFallback>
  >(config.websocketUrl, config.parse, config.getKey)

  // Create wrapper handlers for direct persistence operations with LSN tracking
  const wrappedOnInsert = config.onInsert
    ? async (
        params: InsertMutationFnParams<
          ResolveType<TExplicit, TSchema, TFallback>,
          string | number
        >
      ) => {
        const { beforeLSN, afterLSN } = await config.onInsert!(params)

        // Wait for sync confirmation
        try {
          await utils.awaitSync(beforeLSN, afterLSN)
          debug(`Insert sync confirmed`)
        } catch (error) {
          debug(`Insert sync timeout: %o`, error)
          // Don't throw here, let the mutation complete optimistically
        }

        return { beforeLSN, afterLSN }
      }
    : undefined

  const wrappedOnUpdate = config.onUpdate
    ? async (
        params: UpdateMutationFnParams<
          ResolveType<TExplicit, TSchema, TFallback>,
          string | number
        >
      ) => {
        const { beforeLSN, afterLSN } = await config.onUpdate!(params)

        // Wait for sync confirmation
        try {
          await utils.awaitSync(beforeLSN, afterLSN)
          debug(`Update sync confirmed`)
        } catch (error) {
          debug(`Update sync timeout: %o`, error)
          // Don't throw here, let the mutation complete optimistically
        }

        return { beforeLSN, afterLSN }
      }
    : undefined

  const wrappedOnDelete = config.onDelete
    ? async (
        params: DeleteMutationFnParams<
          ResolveType<TExplicit, TSchema, TFallback>,
          string | number
        >
      ) => {
        const { beforeLSN, afterLSN } = await config.onDelete!(params)

        // Wait for sync confirmation
        try {
          await utils.awaitSync(beforeLSN, afterLSN)
          debug(`Delete sync confirmed`)
        } catch (error) {
          debug(`Delete sync timeout: %o`, error)
          // Don't throw here, let the mutation complete optimistically
        }

        return { beforeLSN, afterLSN }
      }
    : undefined

  return {
    id: config.id,
    schema: config.schema,
    getKey: config.getKey,
    sync: config.sync || { sync },
    startSync: config.startSync,
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils,
  }
}
