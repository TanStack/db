import { ensureIndexForExpression } from "../indexes/auto-index.js"
import { createFilteredCallback } from "../change-events"
import { NegativeActiveSubscribersError } from "../errors"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { CollectionImpl } from "../collection/index.js"
import type {
  ChangeListener,
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
  public changeListeners = new Set<ChangeListener<TOutput, TKey>>()
  public changeKeyListeners = new Map<
    TKey,
    Set<ChangeListener<TOutput, TKey>>
  >()
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
    // Emit empty array directly to all listeners
    for (const listener of this.changeListeners) {
      listener([])
    }
    // Emit to key-specific listeners
    for (const [_key, keyListeners] of this.changeKeyListeners) {
      for (const listener of keyListeners) {
        listener([])
      }
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
    for (const listener of this.changeListeners) {
      listener(eventsToEmit)
    }

    // Emit to key-specific listeners
    if (this.changeKeyListeners.size > 0) {
      // Group changes by key, but only for keys that have listeners
      const changesByKey = new Map<TKey, Array<ChangeMessage<TOutput, TKey>>>()
      for (const change of eventsToEmit) {
        if (this.changeKeyListeners.has(change.key)) {
          if (!changesByKey.has(change.key)) {
            changesByKey.set(change.key, [])
          }
          changesByKey.get(change.key)!.push(change)
        }
      }

      // Emit batched changes to each key's listeners
      for (const [key, keyChanges] of changesByKey) {
        const keyListeners = this.changeKeyListeners.get(key)!
        for (const listener of keyListeners) {
          listener(keyChanges)
        }
      }
    }
  }

  /**
   * Subscribe to changes in the collection
   */
  public subscribeChanges(
    callback: (changes: Array<ChangeMessage<TOutput>>) => void,
    options: SubscribeChangesOptions<TOutput> = {}
  ): () => void {
    // Start sync and track subscriber
    this.addSubscriber()

    // Auto-index for where expressions if enabled
    if (options.whereExpression) {
      ensureIndexForExpression(options.whereExpression, this.collection)
    }

    // Create a filtered callback if where clause is provided
    const filteredCallback =
      options.where || options.whereExpression
        ? createFilteredCallback(callback, options)
        : callback

    if (options.includeInitialState) {
      // First send the current state as changes (filtered if needed)
      const initialChanges = this.collection.currentStateAsChanges({
        where: options.where,
        whereExpression: options.whereExpression,
      })
      filteredCallback(initialChanges)
    }

    // Add to batched listeners
    this.changeListeners.add(filteredCallback)

    return () => {
      this.changeListeners.delete(filteredCallback)
      this.removeSubscriber()
    }
  }

  /**
   * Subscribe to changes for a specific key
   */
  public subscribeChangesKey(
    key: TKey,
    listener: ChangeListener<TOutput, TKey>,
    { includeInitialState = false }: { includeInitialState?: boolean } = {}
  ): () => void {
    // Start sync and track subscriber
    this.addSubscriber()

    if (!this.changeKeyListeners.has(key)) {
      this.changeKeyListeners.set(key, new Set())
    }

    if (includeInitialState) {
      // First send the current state as changes
      listener([
        {
          type: `insert`,
          key,
          value: this.collection.get(key)!,
        },
      ])
    }

    this.changeKeyListeners.get(key)!.add(listener)

    return () => {
      const listeners = this.changeKeyListeners.get(key)
      if (listeners) {
        listeners.delete(listener)
        if (listeners.size === 0) {
          this.changeKeyListeners.delete(key)
        }
      }
      this.removeSubscriber()
    }
  }

  /**
   * Increment the active subscribers count and start sync if needed
   */
  private addSubscriber(): void {
    this.activeSubscribersCount++
    this.collection._lifecycle.cancelGCTimer()

    // Start sync if collection was cleaned up
    if (
      this.collection.status === `cleaned-up` ||
      this.collection.status === `idle`
    ) {
      this.collection._sync.startSync()
    }
  }

  /**
   * Decrement the active subscribers count and start GC timer if needed
   */
  private removeSubscriber(): void {
    this.activeSubscribersCount--

    if (this.activeSubscribersCount === 0) {
      this.collection._lifecycle.startGCTimer()
    } else if (this.activeSubscribersCount < 0) {
      throw new NegativeActiveSubscribersError()
    }
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
