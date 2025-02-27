import {
  ShapeStream,
  ShapeStreamOptions,
  Message,
  Row,
  ControlMessage,
  isChangeMessage,
  isControlMessage,
} from "@electric-sql/client"
import { SyncConfig } from "../types"
import { Store } from "@tanstack/store"

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
  awaitTxid: (txid: string, timeout?: number) => Promise<boolean>
}

function isUpToDateMessage<T extends Row<unknown> = Row>(
  message: Message<T>
): message is ControlMessage & { up_to_date: true } {
  return isControlMessage(message) && message.headers.control === `up-to-date`
}

// Check if a message contains txids in its headers
function hasTxids<T extends Row<unknown> = Row>(
  message: Message<T>
): message is Message<T> & { headers: { txids?: string[] } } {
  return (
    `headers` in message &&
    `txids` in message.headers &&
    Array.isArray(message.headers.txids)
  )
}

export function createElectricSync<T extends Row<unknown> = Row>(
  streamOptions: ShapeStreamOptions
): ElectricSync {
  // Create a store to track seen txids
  const seenTxids = new Store<Set<string>>(new Set())

  // Function to check if a txid has been seen
  const hasTxid = (txid: string): boolean => {
    return seenTxids.state.has(txid)
  }

  // Function to await a specific txid
  const awaitTxid = async (txid: string, timeout = 30000): Promise<boolean> => {
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

  return {
    id: `electric`,
    sync: ({ begin, write, commit }) => {
      const stream = new ShapeStream(streamOptions)
      let transactionStarted = false
      let newTxids = new Set<string>()

      stream.subscribe((messages: Message<T>[]) => {
        let hasUpToDate = false

        for (const message of messages) {
          // Check for txids in the message and add them to our store
          if (hasTxids(message) && message.headers.txids) {
            message.headers.txids?.forEach((txid) => newTxids.add(txid))
          }

          if (isChangeMessage(message)) {
            if (!transactionStarted) {
              begin()
              transactionStarted = true
            }
            write({
              key: message.key,
              type: message.headers.operation,
              value: message.value,
              metadata: message.headers,
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
  }
}
