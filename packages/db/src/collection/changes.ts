import { CollectionSubscription } from "../collection-subscription.js"
import { NegativeActiveSubscribersError } from "../errors"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { CollectionImpl } from "./index.js"
import type {
  ChangeMessage,
  SubscribeChangesOptions,
} from "../types"

export class CollectionChangesManager<
  TOutput extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInput extends object = TOutput,
> {
  public activeSubscribersCount = 0
  public changeSubscriptions = new Set<CollectionSubscription>()
  public batchedEvents: Array<ChangeMessage<TOutput, TKey>> = []
  public shouldBatchEvents = false

  /**
   * Creates a new CollectionChangesManager instance
   */
  constructor(
    public collection: CollectionImpl<TOutput, TKey, any, TSchema, TInput>
  ) {}

  /**
   * Emit an empty ready event to notify subscribers that the collection is ready
   * This bypasses the normal empty array check in emitEvents
   */
  public emitEmptyReadyEvent(): void {
    // Emit empty array directly to all subscribers
    for (const subscription of this.changeSubscriptions) {
      subscription.emitEvents([])
    }
  }

  /**
   * Emit events either immediately or batch them for later emission
   */
  public emitEvents(
    changes: Array<ChangeMessage<TOutput, TKey>>,
    forceEmit = false
  ): void {
    // Skip batching for user actions (forceEmit=true) to keep UI responsive
    if (this.shouldBatchEvents && !forceEmit) {
      // Add events to the batch
      this.batchedEvents.push(...changes)
      return
    }

    // Either we're not batching, or we're forcing emission (user action or ending batch cycle)
    let eventsToEmit = changes

    // If we have batched events and this is a forced emit, combine them
    if (this.batchedEvents.length > 0 && forceEmit) {
      eventsToEmit = [...this.batchedEvents, ...changes]
      this.batchedEvents = []
      this.shouldBatchEvents = false
    }

    if (eventsToEmit.length === 0) return

    // Emit to all listeners
    for (const subscription of this.changeSubscriptions) {
      subscription.emitEvents(eventsToEmit)
    }
  }

  /**
   * Subscribe to changes in the collection
   */
  public subscribeChanges(
    callback: (changes: Array<ChangeMessage<TOutput>>) => void,
    options: SubscribeChangesOptions = {}
  ): CollectionSubscription {
    // Start sync and track subscriber
    this.addSubscriber()

    const subscription = new CollectionSubscription(this.collection, callback, {
      ...options,
      onUnsubscribe: () => {
        this.removeSubscriber()
        this.changeSubscriptions.delete(subscription)
      },
    })

    if (options.includeInitialState) {
      subscription.requestSnapshot()
    }

    // Add to batched listeners
    this.changeSubscriptions.add(subscription)

    return subscription
  }

  /**
   * Increment the active subscribers count and start sync if needed
   */
  private addSubscriber(): void {
    const previousSubscriberCount = this.activeSubscribersCount
    this.activeSubscribersCount++
    this.collection._lifecycle.cancelGCTimer()

    // Start sync if collection was cleaned up
    if (
      this.collection.status === `cleaned-up` ||
      this.collection.status === `idle`
    ) {
      this.collection._sync.startSync()
    }

    this.collection._events.emitSubscribersChange(
      this.activeSubscribersCount,
      previousSubscriberCount
    )
  }

  /**
   * Decrement the active subscribers count and start GC timer if needed
   */
  private removeSubscriber(): void {
    const previousSubscriberCount = this.activeSubscribersCount
    this.activeSubscribersCount--

    if (this.activeSubscribersCount === 0) {
      this.collection._lifecycle.startGCTimer()
    } else if (this.activeSubscribersCount < 0) {
      throw new NegativeActiveSubscribersError()
    }

    this.collection._events.emitSubscribersChange(
      this.activeSubscribersCount,
      previousSubscriberCount
    )
  }

  /**
   * Clean up the collection by stopping sync and clearing data
   * This can be called manually or automatically by garbage collection
   */
  public cleanup(): void {
    this.batchedEvents = []
    this.shouldBatchEvents = false
  }
}
