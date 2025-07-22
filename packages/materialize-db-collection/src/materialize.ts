import { Store } from "@tanstack/store"
import DebugModule from "debug"
import type {
  CollectionConfig,
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
 * Convert a PostgreSQL LSN in the form `XXXXXXXX/XXXXXXXX` into a bigint.
 * The high 32 bits are multiplied by 2^32 and added to the low 32 bits.
 */
function pgLsnToBigInt(lsn: string): bigint {
  const [hi, lo] = lsn.split(`/`)
  return (BigInt(`0x${hi}`) << 32n) + BigInt(`0x${lo}`)
}

/**
 * Convert a Materialize LSN (numeric string) to bigint for comparison.
 */
function materializeLsnToBigInt(lsn: string): bigint {
  return BigInt(lsn)
}

/**
 * Normalize an LSN to bigint for comparison, handling both PostgreSQL and Materialize formats.
 */
function normalizeLsn(lsn: string): bigint {
  if (lsn.includes(`/`)) {
    // PostgreSQL format: "0/1ABAAE0"
    return pgLsnToBigInt(lsn)
  } else {
    // Materialize format: "28027616"
    return materializeLsnToBigInt(lsn)
  }
}

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
  getKey?: (item: T) => string | number
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

    // Clean up any pending buffer timer and process remaining messages
    if (bufferTimer) {
      clearTimeout(bufferTimer)
      bufferTimer = null
      processBufferedMessages()
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
  let collection: any = null

  // Message buffering for differential dataflow merging
  const messageBuffer: Map<string, Array<MaterializeProxyMessage>> = new Map()
  let bufferTimer: NodeJS.Timeout | null = null

  const processBufferedMessages = () => {
    if (!begin || !write || !commit || !getKey) return

    debug(`Processing ${messageBuffer.size} timestamp groups`)

    // Process each timestamp group
    messageBuffer.forEach((messages, timestamp) => {
      debug(
        `Processing timestamp ${timestamp} with ${messages.length} messages`
      )

      // Group messages by key within this timestamp
      const messagesByKey = new Map<any, Array<MaterializeProxyMessage>>()

      messages.forEach((msg) => {
        if (msg.type === `data` && msg.row) {
          // Apply parse transformations first to get the correct key
          let parsedRow = msg.row
          if (parse) {
            parsedRow = { ...msg.row }
            for (const [field, parser] of Object.entries(parse)) {
              if (parsedRow[field] !== undefined) {
                parsedRow[field] = parser(parsedRow[field])
              }
            }
          }

          const key = getKey(parsedRow as T)
          if (!messagesByKey.has(key)) {
            messagesByKey.set(key, [])
          }
          messagesByKey.get(key)!.push({ ...msg, row: parsedRow })
        }
      })

      // Process each key's operations using differential dataflow principles
      const finalOperations: Array<{
        type: `insert` | `update` | `delete`
        value: any
        metadata: any
      }> = []

      messagesByKey.forEach((keyMessages, key) => {
        debug(`Processing key ${key} with ${keyMessages.length} messages`)

        // Separate inserts and deletes first
        const inserts = keyMessages.filter(
          (msg) => parseInt(msg.mz_diff || `0`, 10) > 0
        )
        const deletes = keyMessages.filter(
          (msg) => parseInt(msg.mz_diff || `0`, 10) < 0
        )

        debug(`  Inserts: ${inserts.length}, Deletes: ${deletes.length}`)

        // Check if this is an update (has both inserts and deletes)
        const hasInserts = inserts.length > 0
        const hasDeletes = deletes.length > 0
        const isUpdate = hasInserts && hasDeletes

        // Sum all mz_diff values for this key at this timestamp
        const totalDiff = keyMessages.reduce((sum, msg) => {
          const diff = parseInt(msg.mz_diff || `0`, 10)
          debug(`  Message diff: ${diff}`)
          return sum + diff
        }, 0)

        debug(`  Total diff for key ${key}: ${totalDiff}`)
        debug(`  Is update (has both inserts and deletes): ${isUpdate}`)

        // CRITICAL FIX: Don't skip if it's an update, even if totalDiff === 0
        if (totalDiff === 0 && !isUpdate) {
          // Operations cancel out and it's not an update - no change needed
          debug(
            `  Operations for key ${key} cancel out (not an update), skipping`
          )
          return
        }

        if (totalDiff === 0 && isUpdate) {
          debug(
            `  Total diff is 0 but this is an UPDATE - processing with row-level counting`
          )
        }

        // Determine operation type
        let operationType: `insert` | `update` | `delete`
        let valueToUse: any

        if (isUpdate) {
          // This is an update - determine the final state that should exist
          // Key insight: In differential dataflow, the final state is determined by
          // what has a net positive multiplicity after all changes

          // Group messages by actual row content to see what the final state should be
          const rowCounts = new Map<string, { row: any; count: number }>()

          keyMessages.forEach((msg) => {
            const rowKey = JSON.stringify(msg.row)
            const diff = parseInt(msg.mz_diff || `0`, 10)

            if (!rowCounts.has(rowKey)) {
              rowCounts.set(rowKey, { row: msg.row, count: 0 })
            }
            rowCounts.get(rowKey)!.count += diff
          })

          // Find the row with positive count (this is what should exist)
          let finalRow: any = null
          debug(`    Row-level counting for key ${key}:`)
          for (const [rowKey, data] of rowCounts.entries()) {
            debug(`      Row content: ${rowKey}`)
            debug(`      Count: ${data.count}`)
            if (data.count > 0) {
              finalRow = data.row
              debug(
                `      ^ This row has positive count (+${data.count}), selecting as final state`
              )
              debug(`      Final row data:`, finalRow)
            } else if (data.count < 0) {
              debug(
                `      ^ This row has negative count (${data.count}), will be removed`
              )
            } else {
              debug(`      ^ This row has zero count, operations canceled out`)
            }
          }

          if (!finalRow) {
            debug(
              `  Warning: Update detected but no row has positive count, using latest insert`
            )
            finalRow = inserts[inserts.length - 1]?.row
          }

          valueToUse = finalRow
          operationType = `update`
          debug(`  UPDATE operation determined for key ${key}`)
          debug(`  Final value to apply:`, valueToUse)
          debug(
            `  This should match the PostgreSQL state (row with positive multiplicity)`
          )

          finalOperations.push({
            type: operationType,
            value: valueToUse,
            metadata: {
              mz_timestamp: keyMessages[0]?.mz_timestamp || 0,
              mz_diff: `1`,
              original_diff: `1`,
            },
          })
        } else if (totalDiff > 0) {
          // Net positive with no deletes - pure insert
          const latestInsert = inserts[inserts.length - 1]
          if (!latestInsert) {
            debug(`  Warning: Net positive but no insert found, skipping`)
            return
          }

          valueToUse = latestInsert.row
          operationType = collection?.has(key) ? `update` : `insert`
          debug(`  Net positive (${totalDiff}), operation: ${operationType}`)

          finalOperations.push({
            type: operationType,
            value: valueToUse,
            metadata: {
              mz_timestamp: latestInsert.mz_timestamp,
              mz_diff: totalDiff.toString(),
              original_diff: latestInsert.mz_diff,
            },
          })
        } else if (totalDiff < 0) {
          // Net negative with no inserts - pure delete
          const messageForDelete = deletes[0]
          if (!messageForDelete) {
            debug(`  Warning: Net negative but no delete found, skipping`)
            return
          }

          valueToUse = messageForDelete.row
          operationType = `delete`
          debug(`  Net negative (${totalDiff}), operation: ${operationType}`)

          finalOperations.push({
            type: operationType,
            value: valueToUse,
            metadata: {
              mz_timestamp: messageForDelete.mz_timestamp,
              mz_diff: totalDiff.toString(),
              original_diff: messageForDelete.mz_diff,
            },
          })
        }
        // If totalDiff === 0, operations cancel out, do nothing
      })

      // Apply all final operations for this timestamp
      if (finalOperations.length > 0 && begin && write && commit) {
        debug(
          `Applying ${finalOperations.length} final operations for timestamp ${timestamp}`
        )
        begin()

        finalOperations.forEach((op, index) => {
          debug(`  Operation ${index + 1}: ${op.type}`)
          debug(`  Value being applied to collection:`, op.value)
          debug(`  Metadata:`, op.metadata)
          write!(op)
        })

        commit()
        if (markReady) {
          markReady()
        }
        debug(`All operations for timestamp ${timestamp} applied successfully`)
      } else {
        debug(
          `No operations to apply for timestamp ${timestamp} (operations: ${finalOperations.length}, handlers ready: ${!!(begin && write && commit)})`
        )
      }
    })

    // Clear processed messages
    messageBuffer.clear()
  }

  const bufferMessage = (msg: MaterializeProxyMessage) => {
    if (msg.type !== `data` || !msg.mz_timestamp) return false

    const timestamp = msg.mz_timestamp.toString()

    if (!messageBuffer.has(timestamp)) {
      messageBuffer.set(timestamp, [])
      debug(`Created new buffer for timestamp ${timestamp}`)
    } else {
      debug(`Adding to existing buffer for timestamp ${timestamp}`)
    }

    // Check if this exact message is already in the buffer (this might be the problem!)
    const existingMessages = messageBuffer.get(timestamp)!
    const msgJson = JSON.stringify(msg)
    const isDuplicate = existingMessages.some(
      (existing) => JSON.stringify(existing) === msgJson
    )

    if (isDuplicate) {
      debug(`⚠️  DUPLICATE MESSAGE DETECTED - same message already in buffer!`)
      debug(`  Duplicate: mz_diff=${msg.mz_diff}, row=`, msg.row)
      // Still add it because differential dataflow can have legitimate duplicates
    }

    messageBuffer.get(timestamp)!.push(msg)
    const bufferedMessages = messageBuffer.get(timestamp)!
    debug(
      `Buffered message for timestamp ${timestamp}, total buffered: ${bufferedMessages.length}`
    )
    debug(`  Message: mz_diff=${msg.mz_diff}, row=`, msg.row)
    debug(
      `  All messages in buffer for this timestamp:`,
      bufferedMessages.map((m) => ({ diff: m.mz_diff, row: m.row }))
    )

    // Reset timer to batch messages with the same timestamp
    if (bufferTimer) {
      debug(`Clearing existing buffer timer`)
      clearTimeout(bufferTimer)
    }

    debug(`Setting new buffer timer for 50ms delay`)
    bufferTimer = setTimeout(() => {
      debug(
        `⏰ Buffer timer expired, processing ${messageBuffer.size} timestamp groups`
      )
      debug(
        `Messages in buffer at timer expiry:`,
        Array.from(messageBuffer.entries()).map(([ts, msgs]) => ({
          timestamp: ts,
          count: msgs.length,
        }))
      )
      processBufferedMessages()
      bufferTimer = null
      debug(`Buffer timer cleared after processing`)
    }, 50) // 50ms delay to collect all messages with same timestamp

    return true
  }

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

    // Check if we've already seen an LSN greater than or equal to afterLSN
    if (currentLSN && normalizeLsn(currentLSN) >= normalizeLsn(afterLSN)) {
      debug(
        `Current LSN %s >= afterLSN %s, sync already confirmed`,
        currentLSN,
        afterLSN
      )
      return true
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

        resolve()
      }

      const handleMessage = (event: any) => {
        const data = typeof event === `string` ? event : event.data
        try {
          const msg = JSON.parse(data.toString()) as MaterializeProxyMessage

          // Debug ID specifically if this is a data message
          if (msg.type === `data` && msg.row && msg.row.id !== undefined) {
            debug(`Received message: %o`, msg)
            debug(
              `ID before processing: ${msg.row.id} (type: ${typeof msg.row.id})`
            )
          }

          if (msg.type === `lsn` && msg.value) {
            // Update current LSN
            const newLSN = msg.value
            const tracker = lsnTracker.state
            tracker.currentLSN = newLSN

            // debug(`Updated LSN to: %s`, newLSN)

            // Check pending syncs
            tracker.pendingSyncs.forEach((sync, syncId) => {
              if (normalizeLsn(newLSN) > normalizeLsn(sync.beforeLSN)) {
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

                  if (
                    currentLSN &&
                    normalizeLsn(currentLSN) >= normalizeLsn(sync.afterLSN)
                  ) {
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

          if (msg.type === `data` && msg.row) {
            // Try to buffer the message for differential dataflow merging
            debug(
              `Attempting to buffer message with timestamp: ${msg.mz_timestamp}`
            )
            const wasBuffered = bufferMessage(msg)

            if (!wasBuffered) {
              // Fallback to immediate processing if buffering fails
              debug(
                `Message not buffered (no timestamp), falling back to immediate processing`
              )

              if (begin && write && commit) {
                begin()

                // Apply parse transformations to convert server data to client format
                let parsedRow = msg.row
                debug(`Row before parsing: %o`, parsedRow)
                if (parsedRow.id !== undefined) {
                  debug(
                    `ID before parsing: ${parsedRow.id} (type: ${typeof parsedRow.id})`
                  )
                }

                if (parse) {
                  parsedRow = { ...msg.row }
                  for (const [field, parser] of Object.entries(parse)) {
                    if (parsedRow[field] !== undefined) {
                      const oldValue = parsedRow[field]
                      parsedRow[field] = parser(parsedRow[field])
                      if (field === `id`) {
                        debug(
                          `ID parsing: ${oldValue} (${typeof oldValue}) -> ${parsedRow[field]} (${typeof parsedRow[field]})`
                        )
                      }
                    }
                  }
                }

                debug(`Row after parsing: %o`, parsedRow)
                if (parsedRow.id !== undefined) {
                  debug(
                    `ID after parsing: ${parsedRow.id} (type: ${typeof parsedRow.id})`
                  )
                }

                // Determine operation type from mz_diff
                let operationType: `insert` | `update` | `delete` = `insert`
                if (msg.mz_diff !== undefined) {
                  const key = getKey?.(parsedRow as T)
                  debug(
                    `Operation type determination - key: ${key}, mz_diff: ${msg.mz_diff}, collection.has(key): ${collection?.has(key)}`
                  )
                  operationType =
                    msg.mz_diff === `-1`
                      ? `delete`
                      : msg.mz_diff === `1` && collection?.has(key)
                        ? `update`
                        : `insert`
                }

                debug(`Final operation: ${operationType}, value: %o`, parsedRow)
                if (parsedRow.id !== undefined) {
                  debug(
                    `ID being written: ${parsedRow.id} (type: ${typeof parsedRow.id})`
                  )
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
                if (markReady) {
                  markReady()
                }
              }
            }
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
      // eslint-disable-next-line
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
  >(config.websocketUrl, config.parse || {}, config.getKey)

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
