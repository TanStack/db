import {
  ShapeStream,
  isChangeMessage,
  isControlMessage,
} from "@electric-sql/client"
import { Store } from "@tanstack/store"
import { Collection } from "@tanstack/db"
import type { CollectionConfig, SyncConfig } from "@tanstack/db"
import type {
  ControlMessage,
  Message,
  Row,
  ShapeStreamOptions,
} from "@electric-sql/client"

/**
 * Configuration interface for ElectricCollection
 */
export interface ElectricCollectionConfig<T extends Row<unknown>>
  extends Omit<CollectionConfig<T>, `sync`> {
  /**
   * Configuration options for the ElectricSQL ShapeStream
   */
  streamOptions: ShapeStreamOptions
}

/**
 * Specialized Collection class for ElectricSQL integration
 */
export class ElectricCollection<
  T extends Row<unknown> = Record<string, unknown>,
> extends Collection<T> {
  private seenTxids: Store<Set<number>>

  constructor(config: ElectricCollectionConfig<T>) {
    const seenTxids = new Store<Set<number>>(new Set([Math.random()]))
    const sync = createElectricSync<T>(config.streamOptions, {
      seenTxids,
      getId: config.getId,
    })

    super({ ...config, sync })

    this.seenTxids = seenTxids
  }

  /**
   * Wait for a specific transaction ID to be synced
   * @param txId The transaction ID to wait for
   * @param timeout Optional timeout in milliseconds (defaults to 30000ms)
   * @returns Promise that resolves when the txId is synced
   */
  async awaitTxId(txId: number, timeout = 30000): Promise<boolean> {
    const hasTxid = this.seenTxids.state.has(txId)
    if (hasTxid) return true

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        unsubscribe()
        reject(new Error(`Timeout waiting for txId: ${txId}`))
      }, timeout)

      const unsubscribe = this.seenTxids.subscribe(() => {
        if (this.seenTxids.state.has(txId)) {
          clearTimeout(timeoutId)
          unsubscribe()
          resolve(true)
        }
      })
    })
  }
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
/**
 * Create a new ElectricCollection instance
 */
export function createElectricCollection<T extends Row<unknown>>(
  config: ElectricCollectionConfig<T>
): ElectricCollection<T> {
  return new ElectricCollection(config)
}

/**
 * Internal function to create ElectricSQL sync configuration
 */
function createElectricSync<T extends Row<unknown>>(
  streamOptions: ShapeStreamOptions,
  options: {
    seenTxids: Store<Set<number>>
    getId: (item: T) => string
  }
): SyncConfig<T> {
  const { seenTxids, getId } = options

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
      relation: streamOptions.params?.table
        ? [schema, streamOptions.params.table]
        : undefined,
    }
  }

  return {
    sync: (params: Parameters<SyncConfig<T>[`sync`]>[0]) => {
      const { begin, write, commit } = params
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

            // Use the original key from the message or generate one using getId if available
            let key = message.key
            const value = message.value as unknown as T

            // Use getId to generate the key for insert operations
            if (message.headers.operation === `insert`) {
              try {
                const generatedKey = getId(value)
                key = generatedKey
              } catch (error) {
                // If getId fails, fall back to the original key
                console.warn(
                  `Failed to generate key using getId function:`,
                  error
                )
              }
            }

            // Include the primary key and relation info in the metadata
            const enhancedMetadata = {
              ...message.headers,
            }

            write({
              key,
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
