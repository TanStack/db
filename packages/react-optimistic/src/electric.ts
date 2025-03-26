import {
  ShapeStream,
  isChangeMessage,
  isControlMessage,
} from "@electric-sql/client"
import { Store } from "@tanstack/store"
import type { SyncConfig } from "@tanstack/optimistic"
import type {
  ControlMessage,
  Message,
  Row,
  ShapeStreamOptions,
} from "@electric-sql/client"

// Re-exports
export type * from "@tanstack/optimistic"
export * from "./useCollection"
export type { Collection } from "@tanstack/optimistic"

/**
 * Extended SyncConfig interface with ElectricSQL-specific functionality
 */
export interface ElectricSync extends SyncConfig {
  /**
   * Wait for a specific transaction ID to be synced
   * @param txid The transaction ID to wait for
   * @param timeout Optional timeout in milliseconds (defaults to 30000ms)
   * @returns Promise that resolves when the txid is synced
   */
  awaitTxid: (txid: number, timeout?: number) => Promise<boolean>

  /**
   * Get the sync metadata for insert operations
   * @returns Record containing primaryKey and relation information
   */
  getSyncMetadata: () => Record<string, unknown>
}

function isUpToDateMessage<T extends Row<unknown> = Row>(
  message: Message<T>
): message is ControlMessage & { up_to_date: true } {
  return isControlMessage(message) && message.headers.control === `up-to-date`
}

// Check if a message contains txids in its headers
function hasTxids<T extends Row<unknown> = Row>(
  message: Message<T>
): message is Message<T> & { headers: { txids?: Array<number> } } {
  return (
    `headers` in message &&
    `txids` in message.headers &&
    Array.isArray(message.headers.txids)
  )
}

/**
 * Creates an ElectricSQL sync configuration
 *
 * @param streamOptions - Configuration options for the ShapeStream
 * @param options - Options for the ElectricSync configuration
 * @returns ElectricSync configuration
 */
export function createElectricSync<T extends Row<unknown> = Row>(
  streamOptions: ShapeStreamOptions,
  options: ElectricSyncOptions
): ElectricSync {
  const { primaryKey } = options

  // Create a store to track seen txids
  const seenTxids = new Store<Set<number>>(new Set())

  // Store for the relation schema information
  const relationSchema = new Store<string | undefined>(undefined)

  // Function to check if a txid has been seen
  const hasTxid = (txid: number): boolean => {
    return seenTxids.state.has(txid)
  }

  // Function to await a specific txid
  const awaitTxid = async (txid: number, timeout = 30000): Promise<boolean> => {
    // If we've already seen this txid, resolve immediately
    if (hasTxid(txid)) {
      return true
    }

    // Otherwise, create a promise that resolves when the txid is seen
    return new Promise<boolean>((resolve, reject) => {
      // Set up a timeout
      const timeoutId = setTimeout(() => {
        unsubscribe()
        reject(new Error(`Timeout waiting for txid: ${txid}`))
      }, timeout)

      // Subscribe to the store to watch for the txid
      const unsubscribe = seenTxids.subscribe(() => {
        if (hasTxid(txid)) {
          clearTimeout(timeoutId)
          unsubscribe()
          resolve(true)
        }
      })
    })
  }

  /**
   * Generate a key from a row using the primaryKey columns
   * @param row - The row data
   * @returns A string key formed from the primary key values
   */
  const generateKeyFromRow = (row: T): string => {
    // eslint-disable-next-line
    if (!primaryKey || primaryKey.length === 0) {
      throw new Error(`Primary key is required for Electric sync`)
    }

    return primaryKey
      .map((key) => {
        const value = row[key]
        if (value === undefined) {
          throw new Error(`Primary key column "${key}" not found in row`)
        }
        return String(value)
      })
      .join(`|`)
  }

  /**
   * Get the sync metadata for insert operations
   * @returns Record containing primaryKey and relation information
   */
  const getSyncMetadata = (): Record<string, unknown> => {
    // Use the stored schema if available, otherwise default to 'public'
    const schema = relationSchema.state || `public`

    return {
      primaryKey,
      relation: streamOptions.params?.table
        ? [schema, streamOptions.params.table]
        : undefined,
    }
  }

  return {
    sync: ({ begin, write, commit }) => {
      const stream = new ShapeStream(streamOptions)
      let transactionStarted = false
      let newTxids = new Set<number>()

      stream.subscribe((messages: Array<Message<Row>>) => {
        let hasUpToDate = false

        for (const message of messages) {
          // Check for txids in the message and add them to our store
          if (hasTxids(message) && message.headers.txids) {
            message.headers.txids.forEach((txid) => newTxids.add(txid))
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

            // Use the message's key if available, otherwise generate one from the row using primaryKey
            const key =
              message.key || generateKeyFromRow(message.value as unknown as T)

            // Include the primary key and relation info in the metadata
            const enhancedMetadata = {
              ...message.headers,
              primaryKey,
            }

            write({
              key,
              type: message.headers.operation,
              value: message.value,
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
            newTxids.forEach((txid) => clonedSeen.add(txid))

            newTxids = new Set()
            return clonedSeen
          })
          transactionStarted = false
        }
      })
    },
    // Expose the awaitTxid function
    awaitTxid,
    // Expose the getSyncMetadata function
    getSyncMetadata,
  }
}

/**
 * Configuration options for ElectricSync
 */
export interface ElectricSyncOptions {
  /**
   * Array of column names that form the primary key of the shape
   */
  primaryKey: Array<string>
}
