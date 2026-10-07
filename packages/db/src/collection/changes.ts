import { NegativeActiveSubscribersError } from '../errors'
import { recordPublicationError, withPublicationContext } from '../scheduler.js'
import { runAllCallbacks } from '../utils/callbacks.js'
import {
  createSingleRowRefProxy,
  toExpression,
} from '../query/builder/ref-proxy.js'
import { getBuilderFromConfig } from '../query/live/collection-registry.js'
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
  private deferral:
    | {
        depth: number
        discard: boolean
        stateRevision: number
        layoutRevision: number
        publications: Array<{
          changes: Array<ChangeMessage<TOutput, TKey>>
          layoutChanged: boolean
        }>
      }
    | undefined
  private layoutChangeListeners = new Set<() => void>()
  // Whether this Collection has had a subscriber or a preload in its current
  // sync run. A live-query Collection defers acquisition on its own source
  // subscriptions until then.
  private subscriberOrPreload = false
  private subscriberOrPreloadListeners = new Set<() => void>()

  /**
   * Monotonic revision of the collection's visible state, advanced once per
   * committed batch of changes and cleanup — including while nothing is subscribed.
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
      try {
        runAllCallbacks(
          [...this.changeSubscriptions].map(
            (subscription) => () => subscription.emitEvents([]),
          ),
        )
      } catch (error) {
        recordPublicationError(error)
      }
    })
  }

  /**
   * Enriches a change message with virtual properties ($hasPendingWrites, $synced, $origin, $key, $collectionId).
   * Uses the "add-if-missing" pattern to preserve virtual properties from upstream collections.
   */
  private enrichChangeWithVirtualProps(
    change: ChangeMessage<TOutput, TKey>,
  ): ChangeMessage<WithVirtualProps<TOutput, TKey>, TKey> {
    return this.state.enrichChangeMessage(change)
  }

  // Reduce unpublished same-key changes relative to the subscriber's last
  // visible row: keep the earliest previous row and latest value, and cancel
  // an insert followed by a delete.
  private composeBatchedChange(
    pending: ChangeMessage<TOutput, TKey> | undefined,
    change: ChangeMessage<TOutput, TKey>,
  ): ChangeMessage<TOutput, TKey> | undefined {
    if (!pending) return change

    if (pending.type === `insert`) {
      if (change.type === `delete`) return undefined
      return { ...change, type: `insert`, previousValue: undefined }
    }

    const previousValue =
      pending.type === `update`
        ? (pending.previousValue ?? pending.value)
        : pending.value

    if (change.type === `delete`) {
      return { ...change, value: previousValue, previousValue: undefined }
    }

    return { ...change, type: `update`, previousValue }
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
      // Snapshot virtual properties before later state changes can replace them.
      this.batchedEvents.push(
        ...changes.map((change) => this.enrichChangeWithVirtualProps(change)),
      )
      return
    }

    // Either we're not batching, or we're forcing emission (user action or ending batch cycle)
    let rawEvents = changes

    if (forceEmit) {
      // Force emit is used to end a batch (e.g. after a sync commit). Combine any
      // buffered optimistic events with the final changes so subscribers see the
      // whole picture, even if the sync diff is empty.
      if (this.batchedEvents.length > 0) {
        // Undefined tombstones retain each key's first-seen publication order
        // when an insert/delete pair cancels before a later change revives it.
        const combined = new Map<
          TKey,
          ChangeMessage<TOutput, TKey> | undefined
        >()
        for (const change of [...this.batchedEvents, ...changes]) {
          combined.set(
            change.key,
            this.composeBatchedChange(combined.get(change.key), change),
          )
        }
        rawEvents = [...combined.values()].flatMap((change) => {
          return change ? [change] : []
        })
      }
      this.batchedEvents = []
      this.shouldBatchEvents = false
    }

    if (this.deferral) {
      this.deferral.publications.push({ changes: rawEvents, layoutChanged })
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
    const deferral = (this.deferral ??= {
      depth: 0,
      discard: false,
      stateRevision: this.stateRevision,
      layoutRevision: this.layoutRevision,
      publications: [],
    })
    deferral.depth++
    let closed = false

    const close = (discard: boolean) => {
      // Cleanup can retire this handle while a later sync run owns a deferral.
      if (closed || this.deferral !== deferral) return
      closed = true
      deferral.discard ||= discard

      if (--deferral.depth > 0) return

      const publications = deferral.publications
      deferral.publications = []
      this.deferral = undefined
      if (deferral.discard) {
        this.stateRevision = deferral.stateRevision
        this.layoutRevision = deferral.layoutRevision
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
    const layoutListeners = [...this.layoutChangeListeners]
    const subscriptions = [...this.changeSubscriptions]
    withPublicationContext(() => {
      const callbacks: Array<() => void> = subscriptions.map(
        (subscription) => () => subscription.emitEvents(enrichedEvents),
      )
      if (rawEvents.length === 0) {
        callbacks.unshift(...layoutListeners)
      }
      try {
        runAllCallbacks(callbacks)
      } catch (error) {
        recordPublicationError(error)
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
      changes: Array<ChangeMessage<WithVirtualProps<TOutput, TKey>, TKey>>,
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
      const proxy = createSingleRowRefProxy<
        WithVirtualProps<TOutput, TKey>,
        TKey
      >()
      const result = where(proxy)
      whereExpression = toExpression(result)
    }

    // Acquire ownership only after all fallible option validation and
    // user-provided predicate compilation has completed.
    const defersAcquisition = opts.deferAcquisition === true
    this.addSubscriber(defersAcquisition)

    let subscription: CollectionSubscription | undefined
    const setupState = { closed: false }
    try {
      subscription = new CollectionSubscription(this.collection, callback, {
        ...opts,
        whereExpression,
        deferAcquisition: defersAcquisition,
        onResumeAcquisition: () => this.resumeSubscriber(),
        onUnsubscribe: () => {
          setupState.closed = true
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
      if (!setupState.closed) this.changeSubscriptions.add(subscription)
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

  /** Whether this Collection had a subscriber or a preload in this sync run. */
  public hasSubscriberOrPreload(): boolean {
    return this.subscriberOrPreload
  }

  /** Listen for the first subscriber or preload in the current sync run. */
  public onFirstSubscriberOrPreload(listener: () => void): () => void {
    this.subscriberOrPreloadListeners.add(listener)
    return () => this.subscriberOrPreloadListeners.delete(listener)
  }

  /**
   * Record a subscriber or a preload in the current sync run. A live-query
   * Collection listens for the first one to resume deferred acquisition on its
   * own source subscriptions.
   */
  public markSubscriberOrPreload(): void {
    if (this.subscriberOrPreload) return
    this.subscriberOrPreload = true
    for (const listener of [...this.subscriberOrPreloadListeners]) listener()
  }

  /** A deferring subscription resumed: it may now start this sync run. */
  private resumeSubscriber(): void {
    // Mark first, so a sync run that starts now builds non-deferred demand.
    this.markSubscriberOrPreload()
    this.startSyncIfStopped()
  }

  private startSyncIfStopped(): void {
    if (
      this.lifecycle.status === `cleaned-up` ||
      this.lifecycle.status === `idle`
    ) {
      this.sync.startSync()
    }
  }

  /**
   * Increment the active subscribers count and start sync if needed. A
   * subscriber that defers acquisition starts no provider work. It still
   * starts a live-query Collection, whose sync run reads local memory and
   * defers its own acquisition, but no other Collection's sync run.
   */
  private addSubscriber(defersAcquisition: boolean): void {
    const previousSubscriberCount = this.activeSubscribersCount
    this.activeSubscribersCount++
    this.lifecycle.cancelGCTimer()

    try {
      if (!defersAcquisition) {
        // Mark first, so a sync run that starts now builds non-deferred demand.
        this.markSubscriberOrPreload()
        this.startSyncIfStopped()
      } else if (getBuilderFromConfig(this.collection.config)) {
        this.startSyncIfStopped()
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
    // A preload belongs to one sync run, but subscriptions survive cleanup. A
    // restarted live-query Collection defers acquisition again unless one of
    // its surviving subscribers already asks for data.
    this.subscriberOrPreload = [...this.changeSubscriptions].some(
      (subscription) => !subscription.isDeferringAcquisition(),
    )
    // Cleanup clears visible state without publishing row changes. Detached
    // consumers may miss every status transition before an empty restart.
    this.stateRevision++
    this.batchedEvents = []
    this.shouldBatchEvents = false
    if (this.deferral) this.deferral.publications.length = 0
    this.deferral = undefined
  }
}
