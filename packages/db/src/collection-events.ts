import type { Collection } from "./collection"
import type { CollectionStatus } from "./types"

/**
 * Event emitted when the collection status changes
 */
export interface CollectionStatusChangeEvent {
  type: `status:change`
  collection: Collection
  previousStatus: CollectionStatus
  status: CollectionStatus
}

/**
 * Event emitted when the collection status changes to a specific status
 */
export interface CollectionStatusEvent<T extends CollectionStatus> {
  type: `status:${T}`
  collection: Collection
  previousStatus: CollectionStatus
  status: T
}

/**
 * Event emitted when the number of subscribers to the collection changes
 */
export interface CollectionSubscribersChangeEvent {
  type: `subscribers:change`
  collection: Collection
  previousSubscriberCount: number
  subscriberCount: number
}

export type AllCollectionEvents = {
  "status:change": CollectionStatusChangeEvent
  "subscribers:change": CollectionSubscribersChangeEvent
} & {
  [K in CollectionStatus as `status:${K}`]: CollectionStatusEvent<K>
}

export type CollectionEvent =
  | AllCollectionEvents[keyof AllCollectionEvents]
  | CollectionStatusChangeEvent
  | CollectionSubscribersChangeEvent

export type CollectionEventHandler<T extends keyof AllCollectionEvents> = (
  event: AllCollectionEvents[T]
) => void

export class CollectionEvents {
  private collection: Collection<any, any, any, any, any>
  private listeners = new Map<
    keyof AllCollectionEvents,
    Set<CollectionEventHandler<any>>
  >()

  constructor(collection: Collection<any, any, any, any, any>) {
    this.collection = collection
  }

  on<T extends keyof AllCollectionEvents>(
    event: T,
    callback: CollectionEventHandler<T>
  ) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)

    return () => {
      this.listeners.get(event)!.delete(callback)
    }
  }

  once<T extends keyof AllCollectionEvents>(
    event: T,
    callback: CollectionEventHandler<T>
  ) {
    const unsubscribe = this.on(event, (eventPayload) => {
      callback(eventPayload)
      unsubscribe()
    })
    return unsubscribe
  }

  off<T extends keyof AllCollectionEvents>(
    event: T,
    callback: CollectionEventHandler<T>
  ) {
    this.listeners.get(event)?.delete(callback)
  }

  waitFor<T extends keyof AllCollectionEvents>(
    event: T,
    timeout?: number
  ): Promise<AllCollectionEvents[T]> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined
      const unsubscribe = this.on(event, (eventPayload) => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = undefined
        }
        resolve(eventPayload)
        unsubscribe()
      })
      if (timeout) {
        timeoutId = setTimeout(() => {
          timeoutId = undefined
          unsubscribe()
          reject(new Error(`Timeout waiting for event ${event}`))
        }, timeout)
      }
    })
  }

  emit<T extends keyof AllCollectionEvents>(
    event: T,
    eventPayload: AllCollectionEvents[T]
  ) {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(eventPayload)
      } catch (error) {
        // Re-throw in a microtask to surface the error
        queueMicrotask(() => {
          throw error
        })
      }
    })
  }

  emitStatusChange<T extends CollectionStatus>(
    status: T,
    previousStatus: CollectionStatus
  ) {
    this.emit(`status:change`, {
      type: `status:change`,
      collection: this.collection,
      previousStatus,
      status,
    })

    // Emit specific status event using type assertion
    const eventKey: `status:${T}` = `status:${status}`
    this.emit(eventKey, {
      type: eventKey,
      collection: this.collection,
      previousStatus,
      status,
    } as AllCollectionEvents[`status:${T}`])
  }

  emitSubscribersChange(
    subscriberCount: number,
    previousSubscriberCount: number
  ) {
    this.emit(`subscribers:change`, {
      type: `subscribers:change`,
      collection: this.collection,
      previousSubscriberCount,
      subscriberCount,
    })
  }

  cleanup() {
    this.listeners.clear()
  }
}
