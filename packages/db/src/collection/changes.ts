import { NegativeActiveSubscribersError } from '../errors'
import { withPublicationContext } from '../scheduler.js'
import {
  createSingleRowRefProxy,
  toExpression,
} from '../query/builder/ref-proxy.js'
import { CollectionSubscription } from './subscription.js'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ChangeMessage, SubscribeChangesOptions } from '../types'
import type { CollectionLifecycleManager } from './lifecycle.js'
import type { CollectionSyncManager } from './sync.js'
import type { CollectionEventsManager } from './events.js'
import type { CollectionImpl } from './index.js'
import type { CollectionStateManager } from './state.js'
import type { WithVirtualProps } from '../virtual-props.js'

export type PublicationDeferral = {
  publish: () => void
  discard: () => void
}

export class CollectionChangesManager<
  TOutput extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInput extends object = TOutput,
> {
  private lifecycle!: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
  private sync!: CollectionSyncManager<TOutput, TKey, TSchema, TInput>
  private events!: CollectionEventsManager
  private collection!: CollectionImpl<TOutput, TKey, any, TSchema, TInput>
  private state!: CollectionStateManager<TOutput, TKey, TSchema, TInput>

  public activeSubscribersCount = 0
  public changeSubscriptions = new Set<CollectionSubscription>()
  public batchedEvents: Array<ChangeMessage<TOutput, TKey>> = []
  public shouldBatchEvents = false
  private publicationDeferralDepth = 0
  private discardDeferredPublications = false
  private deferredPublications: Array<{
    changes: Array<ChangeMessage<TOutput, TKey>>
    layoutChanged: boolean
  }> = []
  private layoutChangeListeners = new Set<() => void>()

  /**
   * Monotonic revision of the collection's visible state, advanced once per
   * committed batch of changes — including while nothing is subscribed.
   * Lets consumers (the live-query observer) cheaply detect "did the data
   * change" without subscribing, and stays untouched by subscription
   * bootstrap replays, which do not go through emitEvents.
   */
  public stateRevision = 0

  /**
   * Monotonic revision advanced only for explicit layout-only publications.
   * Observers use it to detect reordered rows whose values did not change.
   */
  public layoutRevision = 0

  /**
   * Creates a new CollectionChangesManager instance
   */
  constructor() {}

  public setDeps(deps: {
    lifecycle: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
    sync: CollectionSyncManager<TOutput, TKey, TSchema, TInput>
    events: CollectionEventsManager
    collection: CollectionImpl<TOutput, TKey, any, TSchema, TInput>
    state: CollectionStateManager<TOutput, TKey, TSchema, TInput>
  }) {
    this.lifecycle = deps.lifecycle
    this.sync = deps.sync
    this.events = deps.events
    this.collection = deps.collection
    this.state = deps.state
  }

  /**
   * Emit an empty ready event to notify subscribers that the collection is ready
   * This bypasses the normal empty array check in emitEvents
   */
  public emitEmptyReadyEvent(): void {
    withPublicationContext(() => {
      for (const subscription of this.changeSubscriptions) {
        subscription.emitEvents([])
      }
    })
  }

  /**
   * Enriches a change message with virtual properties ($synced, $origin, $key, $collectionId).
   * Uses the "add-if-missing" pattern to preserve virtual properties from upstream collections.
   */
  private enrichChangeWithVirtualProps(
    change: ChangeMessage<TOutput, TKey>,
  ): ChangeMessage<WithVirtualProps<TOutput, TKey>, TKey> {
    return this.state.enrichChangeMessage(change)
  }

  /**
   * Emit events either immediately or batch them for later emission
   */
  public emitEvents(
    changes: Array<ChangeMessage<TOutput, TKey>>,
    forceEmit = false,
    layoutChanged = false,
  ): void {
    // The visible state was already committed by the caller, so the revision
    // advances even when the events below end up batched for later emission.
    if (changes.length > 0) this.stateRevision++
    if (layoutChanged) this.layoutRevision++

    // Skip batching for user actions (forceEmit=true) to keep UI responsive
    if (this.shouldBatchEvents && !forceEmit) {
      // Add events to the batch
      this.batchedEvents.push(...changes)
      return
    }

    // Either we're not batching, or we're forcing emission (user action or ending batch cycle)
    let rawEvents = changes

    if (forceEmit) {
      // Force emit is used to end a batch (e.g. after a sync commit). Combine any
      // buffered optimistic events with the final changes so subscribers see the
      // whole picture, even if the sync diff is empty.
      if (this.batchedEvents.length > 0) {
        rawEvents = [...this.batchedEvents, ...changes]
      }
      this.batchedEvents = []
      this.shouldBatchEvents = false
    }

    if (this.publicationDeferralDepth > 0) {
      this.deferredPublications.push({ changes: rawEvents, layoutChanged })
      return
    }

    this.publishEvents(rawEvents, layoutChanged)
  }

  /**
   * Defers subscriber delivery while a coherent multi-Collection publication
   * installs all of its visible state. State and indexes still commit at their
   * normal transaction boundaries.
   */
  public deferPublication(): PublicationDeferral {
    this.publicationDeferralDepth++
    let closed = false

    const close = (discard: boolean) => {
      if (closed) return
      closed = true
      if (this.publicationDeferralDepth === 0) return
      this.discardDeferredPublications ||= discard

      this.publicationDeferralDepth--
      if (this.publicationDeferralDepth > 0) return

      const publications = this.deferredPublications
      this.deferredPublications = []
      if (this.discardDeferredPublications) {
        this.discardDeferredPublications = false
        return
      }
      this.publishEvents(
        publications.flatMap(({ changes }) => changes),
        publications.some(({ layoutChanged }) => layoutChanged),
      )
    }

    return {
      publish: () => close(false),
      discard: () => close(true),
    }
  }

  private publishEvents(
    rawEvents: Array<ChangeMessage<TOutput, TKey>>,
    layoutChanged: boolean,
  ): void {
    if (rawEvents.length === 0 && !layoutChanged) {
      return
    }

    // Enrich all change messages with virtual properties
    // This uses the "add-if-missing" pattern to preserve pass-through semantics
    const enrichedEvents: Array<
      ChangeMessage<WithVirtualProps<TOutput, TKey>, TKey>
    > = rawEvents.map((change) => this.enrichChangeWithVirtualProps(change))

    // Every subscriber sees one committed source batch before dependent query
    // graphs run. This keeps repeated aliases and sibling subqueries coherent.
    withPublicationContext(() => {
      // Notify both internal layout consumers and the public subscription API.
      // Public subscribers historically receive an empty batch for order-only
      // moves because there is no row-value ChangeMessage to publish.
      if (rawEvents.length === 0) {
        for (const listener of this.layoutChangeListeners) listener()
      }

      for (const subscription of this.changeSubscriptions) {
        subscription.emitEvents(enrichedEvents)
      }
    })
  }

  /** Subscribe to layout-only publications. Internal observer channel. */
  public subscribeLayoutChanges(listener: () => void): () => void {
    this.layoutChangeListeners.add(listener)
    return () => this.layoutChangeListeners.delete(listener)
  }

  /**
   * Subscribe to changes in the collection
   */
  public subscribeChanges(
    callback: (
      changes: Array<ChangeMessage<WithVirtualProps<TOutput, TKey>>>,
    ) => void,
    options: SubscribeChangesOptions<TOutput, TKey> = {},
  ): CollectionSubscription {
    // Compile where callback to whereExpression if provided
    if (options.where && options.whereExpression) {
      throw new Error(
        `Cannot specify both 'where' and 'whereExpression' options. Use one or the other.`,
      )
    }

    const { where, ...opts } = options
    let whereExpression = opts.whereExpression
    if (where) {
      const proxy = createSingleRowRefProxy<WithVirtualProps<TOutput, TKey>>()
      const result = where(proxy)
      whereExpression = toExpression(result)
    }

    // Acquire ownership only after all fallible option validation and
    // user-provided predicate compilation has completed.
    this.addSubscriber()

    let subscription: CollectionSubscription | undefined
    try {
      subscription = new CollectionSubscription(this.collection, callback, {
        ...opts,
        whereExpression,
        onUnsubscribe: () => {
          this.removeSubscriber()
          if (subscription) this.changeSubscriptions.delete(subscription)
        },
      })

      // Register status listener BEFORE requesting snapshot to avoid race condition.
      // This ensures the listener catches all status transitions, even if the
      // loadSubset promise resolves synchronously or very quickly.
      if (options.onStatusChange) {
        subscription.on(`status:change`, options.onStatusChange)
      }

      if (options.includeInitialState) {
        subscription.requestSnapshot({
          trackLoadSubsetPromise: false,
          orderBy: options.orderBy,
          limit: options.limit,
          onLoadSubsetResult: options.onLoadSubsetResult,
        })
      } else if (options.includeInitialState === false) {
        // When explicitly set to false (not just undefined), mark all state as "seen"
        // so that all future changes (including deletes) pass through unfiltered.
        subscription.markAllStateAsSeen()
      }

      // Add to batched listeners
      this.changeSubscriptions.add(subscription)
    } catch (error) {
      if (subscription) {
        try {
          subscription.unsubscribe()
        } catch {
          // Preserve the setup error. Cleanup still releases subscriber
          // ownership and attempts every subset unload before it throws.
        }
      } else {
        this.removeSubscriber()
      }
      throw error
    }

    return subscription
  }

  /**
   * Increment the active subscribers count and start sync if needed
   */
  private addSubscriber(): void {
    const previousSubscriberCount = this.activeSubscribersCount
    this.activeSubscribersCount++
    this.lifecycle.cancelGCTimer()

    try {
      // Start sync if collection was cleaned up
      if (
        this.lifecycle.status === `cleaned-up` ||
        this.lifecycle.status === `idle`
      ) {
        this.sync.startSync()
      }
    } catch (error) {
      this.activeSubscribersCount = previousSubscriberCount
      if (this.activeSubscribersCount === 0) {
        this.lifecycle.startGCTimer()
      }
      throw error
    }

    this.events.emitSubscribersChange(
      this.activeSubscribersCount,
      previousSubscriberCount,
    )
  }

  /**
   * Decrement the active subscribers count and start GC timer if needed
   */
  private removeSubscriber(): void {
    const previousSubscriberCount = this.activeSubscribersCount
    this.activeSubscribersCount--

    if (this.activeSubscribersCount === 0) {
      this.lifecycle.startGCTimer()
    } else if (this.activeSubscribersCount < 0) {
      throw new NegativeActiveSubscribersError()
    }

    this.events.emitSubscribersChange(
      this.activeSubscribersCount,
      previousSubscriberCount,
    )
  }

  /**
   * Clean up the collection by stopping sync and clearing data
   * This can be called manually or automatically by garbage collection
   */
  public cleanup(): void {
    this.batchedEvents = []
    this.shouldBatchEvents = false
    this.deferredPublications = []
    this.publicationDeferralDepth = 0
  }
}
