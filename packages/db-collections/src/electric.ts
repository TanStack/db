import {
  ShapeStream,
  isChangeMessage,
  isControlMessage,
} from "@electric-sql/client"
import { Store } from "@tanstack/store"
import type { CollectionConfig, SyncConfig } from "@tanstack/db"
import type {
  ControlMessage,
  Message,
  Row,
  ShapeStreamOptions,
} from "@electric-sql/client"

/**
 * Configuration interface for Electric collection options
 */
export interface ElectricCollectionConfig<T extends Row<unknown>> {
  /**
   * Configuration options for the ElectricSQL ShapeStream
   */
  shapeOptions: ShapeStreamOptions

  /**
   * All standard Collection configuration properties
   */
  id?: string
  schema?: CollectionConfig<T>[`schema`]
  getId: CollectionConfig<T>[`getId`]
  sync?: CollectionConfig<T>[`sync`]
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
 * Creates Electric collection options for use with a standard Collection
 *
 * @param config - Configuration options for the Electric collection
 * @returns Object containing collection options and utility functions
 */
export function electricCollectionOptions<T extends Row<unknown>>(
  config: ElectricCollectionConfig<T>
): {
  collectionOptions: CollectionConfig<T>
  awaitTxId: (txId: number, timeout?: number) => Promise<boolean>
} {
  const seenTxids = new Store<Set<number>>(new Set([Math.random()]))
  const sync = createElectricSync<T>(config.shapeOptions, {
    seenTxids,
  })

  /**
   * Wait for a specific transaction ID to be synced
   * @param txId The transaction ID to wait for
   * @param timeout Optional timeout in milliseconds (defaults to 30000ms)
   * @returns Promise that resolves when the txId is synced
   */
  const awaitTxId = async (txId: number, timeout = 30000): Promise<boolean> => {
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

  // Extract standard Collection config properties
  const { shapeOptions, ...restConfig } = config

  return {
    collectionOptions: {
      ...restConfig,
      sync,
    },
    awaitTxId,
  }
}

/**
 * Internal function to create ElectricSQL sync configuration
 */
function createElectricSync<T extends Row<unknown>>(
  shapeOptions: ShapeStreamOptions,
  options: {
    seenTxids: Store<Set<number>>
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
            newTxids.forEach((txid) => clonedSeen.add(txid))

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
