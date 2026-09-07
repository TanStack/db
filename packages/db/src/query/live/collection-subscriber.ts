import { normalizeExpressionPaths } from '../compiler/expressions.js'
import {
  OrderedSourceLoader,
  computeSubscriptionOrderByHints,
  reconcileChangesForD2,
  sendChangesToInput,
  splitUpdates,
} from './utils.js'
import { SubsetDemandController } from './subset-demand-controller.js'
import type { Collection } from '../../collection/index.js'
import type {
  ChangeMessage,
  LoadSubsetRequestResult,
  SubscribeChangesOptions,
  SubscriptionLoadSubsetErrorEvent,
  SubscriptionStatusChangeEvent,
} from '../../types.js'
import type { Context, GetResult } from '../builder/types.js'
import type { BasicExpression } from '../ir.js'
import type { OrderByOptimizationInfo } from '../compiler/order-by.js'
import type { CollectionConfigBuilder } from './collection-config-builder.js'
import type { CollectionSubscription } from '../../collection/subscription.js'
import type { LazyDemandPlan } from '../compiler/joins.js'

const loadMoreCallbackSymbol = Symbol.for(
  `@tanstack/db.collection-config-builder`,
)

type TruncateReplayPublicationControl = NonNullable<
  SubscribeChangesOptions[`truncateReplayPublication`]
>

export class CollectionSubscriber<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
> {
  // Track deferred promises for subscription loading states
  private subscriptionLoadingPromises = new Map<
    CollectionSubscription,
    { resolve: () => void }
  >()

  // Exact row last contributed to D2 for each source key.
  private sentToD2Rows = new Map<string | number, Record<string, unknown>>()

  // Direct load tracking callback for ordered path (set during subscribeToOrderedChanges,
  // used by loadNextItems for subsequent requestLimitedSnapshot calls)
  private orderedLoader: OrderedSourceLoader | undefined
  private readonly demand = new SubsetDemandController()

  constructor(
    private sourceId: string,
    private alias: string,
    private collection: Collection,
    private collectionConfigBuilder: CollectionConfigBuilder<TContext, TResult>,
  ) {}

  subscribe(): CollectionSubscription {
    const whereClause = this.getWhereClause()

    if (whereClause) {
      const whereExpression = normalizeExpressionPaths(whereClause, this.alias)
      return this.subscribeToChanges(whereExpression)
    }

    return this.subscribeToChanges()
  }

  private subscribeToChanges(whereExpression?: BasicExpression<boolean>) {
    const orderByInfo = this.getOrderByInfo()

    // Direct load promise tracking: pipes loadSubset results straight to the
    // live query collection, avoiding the multi-hop deferred promise chain that
    // can break under microtask timing (e.g., queueMicrotask in TanStack Query).
    const trackLoadResult = (result: LoadSubsetRequestResult) => {
      if (result instanceof Promise) {
        // Defer the tracked rejection by one microtask so the subscription's
        // error event can put an initial live query in error before loading
        // state would otherwise let it become ready.
        const trackedResult = result.catch(async (error: unknown) => {
          await Promise.resolve()
          throw error
        })
        this.collectionConfigBuilder.trackSubsetLoadPromise(trackedResult)
      }
    }

    // Status change handler - passed to subscribeChanges so it's registered
    // BEFORE any snapshot is requested, preventing race conditions.
    // Used as a fallback for status transitions not covered by direct tracking
    // (e.g., truncate-triggered reloads that call trackLoadSubsetPromise directly).
    const onStatusChange = (event: SubscriptionStatusChangeEvent) => {
      if (this.collectionConfigBuilder.isLazySource(this.sourceId)) return
      const subscription = event.subscription as CollectionSubscription
      if (event.status === `loadingSubset`) {
        this.ensureLoadingPromise(subscription)
      } else {
        // status is 'ready'
        const deferred = this.subscriptionLoadingPromises.get(subscription)
        if (deferred) {
          this.subscriptionLoadingPromises.delete(subscription)
          deferred.resolve()
        }
      }
    }
    const onLoadSubsetError = (event: SubscriptionLoadSubsetErrorEvent) => {
      this.collectionConfigBuilder.recordSubsetError(
        event.error,
        // Lazy demand owns its fatal-error path. For eager sources, one
        // successful page does not finish initial ordered refinement.
        !this.collectionConfigBuilder.isLazySource(this.sourceId) &&
          this.collectionConfigBuilder.liveQueryCollection?.status ===
            `loading`,
      )
    }

    // Create subscription with onStatusChange - listener is registered before any async work
    let subscription: CollectionSubscription
    if (orderByInfo) {
      subscription = this.subscribeToOrderedChanges(
        whereExpression,
        orderByInfo,
        onStatusChange,
        trackLoadResult,
        onLoadSubsetError,
      )
    } else {
      // Lazy sources load only the subsets demanded by the compiled graph.
      const includeInitialState =
        this.collectionConfigBuilder.query.limit !== 0 &&
        !this.collectionConfigBuilder.isLazySource(this.sourceId)

      subscription = this.subscribeToMatchingChanges(
        whereExpression,
        includeInitialState,
        onStatusChange,
        trackLoadResult,
        onLoadSubsetError,
      )
      this.registerSubscriptionCleanup(subscription)
    }

    // Check current status after subscribing - if status is 'loadingSubset', track it.
    // The onStatusChange listener will catch the transition to 'ready'.
    if (
      !this.collectionConfigBuilder.isLazySource(this.sourceId) &&
      subscription.status === `loadingSubset`
    ) {
      this.ensureLoadingPromise(subscription)
    }

    return subscription
  }

  private registerSubscriptionCleanup(
    subscription: CollectionSubscription,
  ): void {
    const unsubscribe = () => {
      // If subscription has a pending promise, resolve it before unsubscribing
      const deferred = this.subscriptionLoadingPromises.get(subscription)
      if (deferred) {
        this.subscriptionLoadingPromises.delete(subscription)
        deferred.resolve()
      }

      this.demand.clear()
      subscription.unsubscribe()
    }
    // currentSyncState is always defined when subscribe() is called
    // (called during sync session setup)
    this.collectionConfigBuilder.currentSyncState!.unsubscribeCallbacks.add(
      unsubscribe,
    )
  }

  setDemand(
    subscription: CollectionSubscription,
    plan: LazyDemandPlan,
    keys: Set<unknown>,
  ): void {
    let update
    try {
      update = this.demand.setDemand(subscription, plan, keys)
    } catch (error) {
      // CollectionSubscription reports adapter failures before rethrowing.
      // Convert that synchronous form to the same query-local fatal demand
      // state as a rejected load, without letting it escape the source commit.
      // Preserve unrelated graph/programming errors as throws.
      if (!Object.is(subscription.lastError, error)) throw error
      const isInitialSync =
        this.collectionConfigBuilder.liveQueryCollection?.status === `loading`
      const generation = this.collectionConfigBuilder.beginDemand(plan.id)
      this.collectionConfigBuilder.failDemand(plan.id, generation, error)
      if (isInitialSync) throw error
      return
    }
    if (!update.changed) return

    if (update.empty) {
      this.collectionConfigBuilder.retireDemand(plan.id)
      return
    }

    const generation = this.collectionConfigBuilder.beginDemand(plan.id)
    if (update.ready instanceof Promise) {
      this.collectionConfigBuilder.trackSubsetLoadOperationPromise(update.ready)
      void update.ready.then(
        () => this.collectionConfigBuilder.settleDemand(plan.id, generation),
        (error) =>
          this.collectionConfigBuilder.failDemand(plan.id, generation, error),
      )
    } else {
      this.collectionConfigBuilder.settleDemand(plan.id, generation)
    }
  }

  private sendChangesToPipeline(
    changes: Iterable<ChangeMessage<any, string | number>>,
    callback?: () => void,
  ) {
    const changesArray = Array.isArray(changes) ? changes : [...changes]
    const reconciledChanges = reconcileChangesForD2(
      changesArray,
      this.sentToD2Rows,
    )
    // currentSyncState and input are always defined when this method is called
    // (only called from active subscriptions during a sync session)
    const input =
      this.collectionConfigBuilder.currentSyncState!.inputs[this.sourceId]!
    const sentChanges = sendChangesToInput(input, reconciledChanges)

    // Do not provide the callback that loads more data
    // if there's no more data to load
    // otherwise we end up in an infinite loop trying to load more data
    const dataLoader = sentChanges > 0 ? callback : undefined

    // We need to schedule a graph run even if there's no data to load
    // because we need to mark the collection as ready if it's not already
    // and that's only done in `scheduleGraphRun`
    this.collectionConfigBuilder.scheduleGraphRun(dataLoader, {
      sourceId: this.sourceId,
    })
  }

  private subscribeToMatchingChanges(
    whereExpression: BasicExpression<boolean> | undefined,
    includeInitialState: boolean,
    onStatusChange: (event: SubscriptionStatusChangeEvent) => void,
    onLoadSubsetResult: (result: LoadSubsetRequestResult) => void,
    onLoadSubsetError: (event: SubscriptionLoadSubsetErrorEvent) => void,
  ): CollectionSubscription {
    const sendChanges = (
      changes: Array<ChangeMessage<any, string | number>>,
    ) => {
      this.sendChangesToPipeline(changes)
    }

    // Get the query's orderBy and limit to pass to loadSubset.
    const hints = computeSubscriptionOrderByHints(
      this.collectionConfigBuilder.query,
      this.alias,
    )

    // Track loading via the loadSubset promise directly.
    // requestSnapshot uses trackLoadSubsetPromise: false (needed for truncate handling),
    // so we use onLoadSubsetResult to get the promise and track it ourselves.
    const subscription = this.collection.subscribeChanges(sendChanges, {
      ...(includeInitialState && { includeInitialState }),
      whereExpression,
      onStatusChange,
      onLoadSubsetError,
      truncateReplayPublication: this.truncateReplayPublicationControl(),
      orderBy: hints.orderBy,
      limit: hints.limit,
      onLoadSubsetResult: includeInitialState ? onLoadSubsetResult : undefined,
    })

    return subscription
  }

  private subscribeToOrderedChanges(
    whereExpression: BasicExpression<boolean> | undefined,
    orderByInfo: OrderByOptimizationInfo,
    onStatusChange: (event: SubscriptionStatusChangeEvent) => void,
    onLoadSubsetResult: (result: LoadSubsetRequestResult) => void,
    onLoadSubsetError: (event: SubscriptionLoadSubsetErrorEvent) => void,
  ): CollectionSubscription {
    // Use a holder to forward-reference subscription in the callback
    const subscriptionHolder: { current?: CollectionSubscription } = {}

    const sendChangesInRange = (
      changes: Iterable<ChangeMessage<any, string | number>>,
    ) => {
      const subscription = subscriptionHolder.current
      if (!subscription) return
      const changesArray = Array.isArray(changes) ? changes : [...changes]

      this.orderedLoader?.onSourceChanges(changesArray, this.sentToD2Rows)

      // Split live updates into a delete of the old value and an insert of the new value
      const splittedChanges = splitUpdates(changesArray)
      this.sendChangesToPipelineWithTracking(splittedChanges, subscription)
    }

    // Subscribe to changes with onStatusChange - listener is registered before any snapshot
    // values bigger than what we've sent don't need to be sent because they can't affect the topK
    const subscription = this.collection.subscribeChanges(sendChangesInRange, {
      whereExpression,
      onStatusChange,
      onLoadSubsetError,
      truncateReplayPublication: this.truncateReplayPublicationControl(() => {
        // Recovery favors a simple, authoritative rebuild over resuming a
        // fragile cursor. The retained full-source demand is replayed on later
        // truncates, so this adds at most one demand per subscription.
        // Queue startup inside the publication barrier too: a synchronous
        // throw establishes no acquisition for the replay to wait on.
        const loader = this.orderedLoader
        this.collectionConfigBuilder.trackOrderedLoadPromise(
          Promise.resolve().then(() => loader?.loadFullSource()),
          true,
        )
      }),
    })
    subscriptionHolder.current = subscription
    this.registerSubscriptionCleanup(subscription)

    // Reset ordered-load state on truncate. Keep exact D2 rows until the
    // replacement publication retracts or replaces them.
    const truncateUnsubscribe = this.collection.on(`truncate`, () => {
      this.orderedLoader?.resetCursor()
    })

    // Clean up truncate listener when subscription is unsubscribed
    subscription.on(`unsubscribed`, () => {
      truncateUnsubscribe()
      subscriptionHolder.current = undefined
      this.orderedLoader?.dispose()
      this.orderedLoader = undefined
    })

    this.orderedLoader = new OrderedSourceLoader(
      orderByInfo,
      subscription,
      this.alias,
      (result, holdPublication) => {
        if (result instanceof Promise) {
          this.collectionConfigBuilder.trackOrderedLoadPromise(
            result,
            holdPublication && !subscription.hasPendingTruncateReplacement,
          )
        }
        onLoadSubsetResult(result)
      },
    )
    this.orderedLoader.start()

    return subscription
  }

  private truncateReplayPublicationControl(
    onStart?: () => void,
  ): TruncateReplayPublicationControl {
    const syncSession = this.collectionConfigBuilder.getSyncSession()
    return {
      start: () => {
        onStart?.()
      },
      succeed: () => {
        if (syncSession !== this.collectionConfigBuilder.getSyncSession()) {
          return
        }
        this.orderedLoader?.settleFullSourceReplay()
        this.collectionConfigBuilder.scheduleGraphRunForSession(syncSession)
      },
    }
  }

  // This function is called by maybeRunGraph
  // after each iteration of the query pipeline
  // to ensure that the orderBy operator has enough data to work with
  loadMoreIfNeeded(subscription: CollectionSubscription): void {
    if (
      subscription.hasPendingTruncateReplacement &&
      !this.collectionConfigBuilder.hasActiveWindowOperation()
    ) {
      return
    }

    const orderByInfo = this.getOrderByInfo()

    if (!orderByInfo) {
      // This query has no orderBy operator
      // so there's no data to load
      return
    }

    try {
      const pending = this.orderedLoader?.loadMore(
        this.collectionConfigBuilder.getActiveWindowOperationGeneration(),
      )
      if (pending) {
        this.collectionConfigBuilder.trackSubsetLoadOperationPromise(pending)
      }
    } catch (error) {
      if (!Object.is(subscription.lastError, error)) throw error
    }
  }

  private sendChangesToPipelineWithTracking(
    changes: Iterable<ChangeMessage<any, string | number>>,
    subscription: CollectionSubscription,
  ) {
    const orderByInfo = this.getOrderByInfo()
    if (!orderByInfo) {
      this.sendChangesToPipeline(changes)
      return
    }

    // Cache the loadMoreIfNeeded callback on the subscription using a symbol property.
    // This ensures we pass the same function instance to the scheduler each time,
    // allowing it to deduplicate callbacks when multiple changes arrive during a transaction.
    type SubscriptionWithLoader = CollectionSubscription & {
      [loadMoreCallbackSymbol]?: () => void
    }

    const subscriptionWithLoader = subscription as SubscriptionWithLoader

    subscriptionWithLoader[loadMoreCallbackSymbol] ??=
      this.loadMoreIfNeeded.bind(this, subscription)

    this.sendChangesToPipeline(
      changes,
      subscriptionWithLoader[loadMoreCallbackSymbol],
    )
  }

  private getWhereClause(): BasicExpression<boolean> | undefined {
    const sourceWhereClausesCache =
      this.collectionConfigBuilder.sourceWhereClausesCache
    if (!sourceWhereClausesCache) {
      return undefined
    }
    return sourceWhereClausesCache.get(this.sourceId)
  }

  private getOrderByInfo(): OrderByOptimizationInfo | undefined {
    const info =
      this.collectionConfigBuilder.optimizableOrderByCollections[this.sourceId]
    if (info?.sourceId === this.sourceId) {
      return info
    }
    return undefined
  }

  private ensureLoadingPromise(subscription: CollectionSubscription) {
    if (this.subscriptionLoadingPromises.has(subscription)) {
      return
    }

    let resolve: () => void
    const promise = new Promise<void>((res) => {
      resolve = res
    })

    this.subscriptionLoadingPromises.set(subscription, {
      resolve: resolve!,
    })
    this.collectionConfigBuilder.trackSubsetLoadPromise(promise)
  }
}
