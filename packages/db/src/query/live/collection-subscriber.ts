import { serializeValue } from '@tanstack/db-ivm'
import {
  normalizeExpressionPaths,
  normalizeOrderByPaths,
} from '../compiler/expressions.js'
import { sendChangesToInput, splitUpdates } from './utils.js'
import type { Collection } from '../../collection/index.js'
import type {
  ChangeMessage,
  SubscriptionStatusChangeEvent,
} from '../../types.js'
import type { Context, GetResult } from '../builder/types.js'
import type { BasicExpression } from '../ir.js'
import type { OrderByOptimizationInfo } from '../compiler/order-by.js'
import type { CollectionConfigBuilder } from './collection-config-builder.js'
import type { CollectionSubscription } from '../../collection/subscription.js'

const loadMoreCallbackSymbol = Symbol.for(
  `@tanstack/db.collection-config-builder`,
)

export class CollectionSubscriber<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
> {
  // Keep track of the biggest value we've sent so far (needed for orderBy optimization)
  private biggest: any = undefined

  // Track the most recent ordered load request key (cursor + window).
  // This avoids infinite loops from cached data re-writes while still allowing
  // window moves or new keys at the same cursor value to trigger new requests.
  private lastLoadRequestKey: string | undefined

  // Track deferred promises for subscription loading states
  private subscriptionLoadingPromises = new Map<
    CollectionSubscription,
    { resolve: () => void }
  >()

  // Track keys that have been sent to the D2 pipeline to prevent duplicate inserts
  // This is necessary because different code paths (initial load, change events)
  // can potentially send the same item to D2 multiple times.
  private sentToD2Keys = new Set<string | number>()

  // Direct load tracking callback for ordered path (set during subscribeToOrderedChanges,
  // used by loadNextItems for subsequent requestLimitedSnapshot calls)
  private orderedLoadSubsetResult?: (result: Promise<void> | true) => void
  private pendingOrderedLoadPromise: Promise<void> | undefined

  constructor(
    private alias: string,
    private collectionId: string,
    private collection: Collection,
    private collectionConfigBuilder: CollectionConfigBuilder<TContext, TResult>,
  ) {}

  subscribe(): CollectionSubscription {
    const whereClause = this.getWhereClauseForAlias()

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
    const trackLoadResult = (result: Promise<void> | true) => {
      if (result instanceof Promise) {
        this.collectionConfigBuilder.liveQueryCollection!._sync.trackLoadPromise(
          result,
        )
      }
    }

    // Status change handler - passed to subscribeChanges so it's registered
    // BEFORE any snapshot is requested, preventing race conditions.
    // Used as a fallback for status transitions not covered by direct tracking
    // (e.g., truncate-triggered reloads that call trackLoadSubsetPromise directly).
    const onStatusChange = (event: SubscriptionStatusChangeEvent) => {
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

    // Create subscription with onStatusChange - listener is registered before any async work
    let subscription: CollectionSubscription
    if (orderByInfo) {
      subscription = this.subscribeToOrderedChanges(
        whereExpression,
        orderByInfo,
        onStatusChange,
        trackLoadResult,
      )
    } else {
      // If the source alias is lazy then we should not include the initial state
      const includeInitialState = !this.collectionConfigBuilder.isLazyAlias(
        this.alias,
      )

      subscription = this.subscribeToMatchingChanges(
        whereExpression,
        includeInitialState,
        onStatusChange,
      )
    }

    // Check current status after subscribing - if status is 'loadingSubset', track it.
    // The onStatusChange listener will catch the transition to 'ready'.
    if (subscription.status === `loadingSubset`) {
      this.ensureLoadingPromise(subscription)
    }

    const unsubscribe = () => {
      // If subscription has a pending promise, resolve it before unsubscribing
      const deferred = this.subscriptionLoadingPromises.get(subscription)
      if (deferred) {
        this.subscriptionLoadingPromises.delete(subscription)
        deferred.resolve()
      }

      subscription.unsubscribe()
    }
    // currentSyncState is always defined when subscribe() is called
    // (called during sync session setup)
    this.collectionConfigBuilder.currentSyncState!.unsubscribeCallbacks.add(
      unsubscribe,
    )
    return subscription
  }

  private sendChangesToPipeline(
    changes: Iterable<ChangeMessage<any, string | number>>,
    callback?: () => boolean,
  ) {
    // Filter changes to prevent duplicate inserts to D2 pipeline.
    // This ensures D2 multiplicity stays at 1 for visible items, so deletes
    // properly reduce multiplicity to 0 (triggering DELETE output).
    const changesArray = Array.isArray(changes) ? changes : [...changes]
    const filteredChanges: Array<ChangeMessage<any, string | number>> = []
    for (const change of changesArray) {
      if (change.type === `insert`) {
        if (this.sentToD2Keys.has(change.key)) {
          // Skip duplicate insert - already sent to D2
          continue
        }
        this.sentToD2Keys.add(change.key)
      } else if (change.type === `delete`) {
        // Remove from tracking so future re-inserts are allowed
        this.sentToD2Keys.delete(change.key)
      }
      // Updates are handled as delete+insert by splitUpdates, so no special handling needed
      filteredChanges.push(change)
    }

    // currentSyncState and input are always defined when this method is called
    // (only called from active subscriptions during a sync session)
    const input =
      this.collectionConfigBuilder.currentSyncState!.inputs[this.alias]!
    const sentChanges = sendChangesToInput(
      input,
      filteredChanges,
      this.collection.config.getKey,
    )

    // Do not provide the callback that loads more data
    // if there's no more data to load
    // otherwise we end up in an infinite loop trying to load more data
    const dataLoader = sentChanges > 0 ? callback : undefined

    // We need to schedule a graph run even if there's no data to load
    // because we need to mark the collection as ready if it's not already
    // and that's only done in `scheduleGraphRun`
    this.collectionConfigBuilder.scheduleGraphRun(dataLoader, {
      alias: this.alias,
    })
  }

  private subscribeToMatchingChanges(
    whereExpression: BasicExpression<boolean> | undefined,
    includeInitialState: boolean,
    onStatusChange: (event: SubscriptionStatusChangeEvent) => void,
  ): CollectionSubscription {
    const sendChanges = (
      changes: Array<ChangeMessage<any, string | number>>,
    ) => {
      this.sendChangesToPipeline(changes)
    }

    // Get the query's orderBy and limit to pass to loadSubset.
    // Only include orderBy when it is scoped to this alias and uses simple refs,
    // to avoid leaking cross-collection paths into backend-specific compilers.
    const { orderBy, limit, offset } = this.collectionConfigBuilder.query
    const effectiveLimit =
      limit !== undefined && offset !== undefined ? limit + offset : limit
    const normalizedOrderBy = orderBy
      ? normalizeOrderByPaths(orderBy, this.alias)
      : undefined
    const canPassOrderBy =
      normalizedOrderBy?.every((clause) => {
        const exp = clause.expression
        if (exp.type !== `ref`) {
          return false
        }
        const path = exp.path
        return Array.isArray(path) && path.length === 1
      }) ?? false
    const orderByForSubscription = canPassOrderBy
      ? normalizedOrderBy
      : undefined
    const limitForSubscription = canPassOrderBy ? effectiveLimit : undefined

    // Track loading via the loadSubset promise directly.
    // requestSnapshot uses trackLoadSubsetPromise: false (needed for truncate handling),
    // so we use onLoadSubsetResult to get the promise and track it ourselves.
    const onLoadSubsetResult = includeInitialState
      ? (result: Promise<void> | true) => {
          if (result instanceof Promise) {
            this.collectionConfigBuilder.liveQueryCollection!._sync.trackLoadPromise(
              result,
            )
          }
        }
      : undefined

    const subscription = this.collection.subscribeChanges(sendChanges, {
      ...(includeInitialState && { includeInitialState }),
      whereExpression,
      onStatusChange,
      orderBy: orderByForSubscription,
      limit: limitForSubscription,
      onLoadSubsetResult,
    })

    return subscription
  }

  private subscribeToOrderedChanges(
    whereExpression: BasicExpression<boolean> | undefined,
    orderByInfo: OrderByOptimizationInfo,
    onStatusChange: (event: SubscriptionStatusChangeEvent) => void,
    onLoadSubsetResult: (result: Promise<void> | true) => void,
  ): CollectionSubscription {
    const { orderBy, offset, limit, index } = orderByInfo

    // Store the callback so loadNextItems can also use direct tracking.
    // Track in-flight ordered loads to avoid issuing redundant requests while
    // a previous snapshot is still pending.
    const handleLoadSubsetResult = (result: Promise<void> | true) => {
      if (result instanceof Promise) {
        this.pendingOrderedLoadPromise = result
        result.finally(() => {
          if (this.pendingOrderedLoadPromise === result) {
            this.pendingOrderedLoadPromise = undefined
          }
        })
      }
      onLoadSubsetResult(result)
    }

    this.orderedLoadSubsetResult = handleLoadSubsetResult

    // Use a holder to forward-reference subscription in the callback
    const subscriptionHolder: { current?: CollectionSubscription } = {}

    const sendChangesInRange = (
      changes: Iterable<ChangeMessage<any, string | number>>,
    ) => {
      const changesArray = Array.isArray(changes) ? changes : [...changes]

      this.trackSentValues(changesArray, orderByInfo.comparator)

      // Split live updates into a delete of the old value and an insert of the new value
      const splittedChanges = splitUpdates(changesArray)
      this.sendChangesToPipelineWithTracking(
        splittedChanges,
        subscriptionHolder.current!,
      )
    }

    // Subscribe to changes with onStatusChange - listener is registered before any snapshot
    // values bigger than what we've sent don't need to be sent because they can't affect the topK
    const subscription = this.collection.subscribeChanges(sendChangesInRange, {
      whereExpression,
      onStatusChange,
    })
    subscriptionHolder.current = subscription

    // Listen for truncate events to reset cursor tracking state and sentToD2Keys
    // This ensures that after a must-refetch/truncate, we don't use stale cursor data
    // and allow re-inserts of previously sent keys
    const truncateUnsubscribe = this.collection.on(`truncate`, () => {
      this.biggest = undefined
      this.lastLoadRequestKey = undefined
      this.pendingOrderedLoadPromise = undefined
      this.sentToD2Keys.clear()
    })

    // Clean up truncate listener when subscription is unsubscribed
    subscription.on(`unsubscribed`, () => {
      truncateUnsubscribe()
    })

    // Normalize the orderBy clauses such that the references are relative to the collection
    const normalizedOrderBy = normalizeOrderByPaths(orderBy, this.alias)

    // Trigger the snapshot request — use direct load tracking (trackLoadSubsetPromise: false)
    // to pipe the loadSubset result straight to the live query collection. This bypasses
    // the subscription status → onStatusChange → deferred promise chain which is fragile
    // under microtask timing (e.g., queueMicrotask delays in TanStack Query observers).
    if (index) {
      // We have an index on the first orderBy column - use lazy loading optimization
      subscription.setOrderByIndex(index)

      subscription.requestLimitedSnapshot({
        limit: offset + limit,
        orderBy: normalizedOrderBy,
        trackLoadSubsetPromise: false,
        onLoadSubsetResult: handleLoadSubsetResult,
      })
    } else {
      // No index available (e.g., non-ref expression): pass orderBy/limit to loadSubset
      subscription.requestSnapshot({
        orderBy: normalizedOrderBy,
        limit: offset + limit,
        trackLoadSubsetPromise: false,
        onLoadSubsetResult: handleLoadSubsetResult,
      })
    }

    return subscription
  }

  // This function is called by maybeRunGraph
  // after each iteration of the query pipeline
  // to ensure that the orderBy operator has enough data to work with
  loadMoreIfNeeded(subscription: CollectionSubscription) {
    const orderByInfo = this.getOrderByInfo()

    if (!orderByInfo) {
      // This query has no orderBy operator
      // so there's no data to load
      return true
    }

    const { dataNeeded } = orderByInfo

    if (!dataNeeded) {
      // dataNeeded is not set when there's no index (e.g., non-ref expression).
      // In this case, we've already loaded all data via requestSnapshot
      // and don't need to lazily load more.
      return true
    }

    if (this.pendingOrderedLoadPromise) {
      // Wait for in-flight ordered loads to resolve before issuing another request.
      return true
    }

    // `dataNeeded` probes the orderBy operator to see if it needs more data
    // if it needs more data, it returns the number of items it needs
    const n = dataNeeded()
    if (n > 0) {
      this.loadNextItems(n, subscription)
    }
    return true
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
      [loadMoreCallbackSymbol]?: () => boolean
    }

    const subscriptionWithLoader = subscription as SubscriptionWithLoader

    subscriptionWithLoader[loadMoreCallbackSymbol] ??=
      this.loadMoreIfNeeded.bind(this, subscription)

    this.sendChangesToPipeline(
      changes,
      subscriptionWithLoader[loadMoreCallbackSymbol],
    )
  }

  // Loads the next `n` items from the collection
  // starting from the biggest item it has sent
  private loadNextItems(n: number, subscription: CollectionSubscription) {
    const orderByInfo = this.getOrderByInfo()
    if (!orderByInfo) {
      return
    }
    const { orderBy, valueExtractorForRawRow, offset } = orderByInfo
    const biggestSentRow = this.biggest

    // Extract all orderBy column values from the biggest sent row
    // For single-column: returns single value, for multi-column: returns array
    const extractedValues = biggestSentRow
      ? valueExtractorForRawRow(biggestSentRow)
      : undefined

    // Normalize to array format for minValues
    let minValues: Array<unknown> | undefined
    if (extractedValues !== undefined) {
      minValues = Array.isArray(extractedValues)
        ? extractedValues
        : [extractedValues]
    }

    const loadRequestKey = this.getLoadRequestKey({
      minValues,
      offset,
      limit: n,
    })

    // Skip if we already requested a load for this cursor+window.
    // This prevents infinite loops from cached data re-writes while still allowing
    // window moves (offset/limit changes) to trigger new requests.
    if (this.lastLoadRequestKey === loadRequestKey) {
      return
    }

    // Normalize the orderBy clauses such that the references are relative to the collection
    const normalizedOrderBy = normalizeOrderByPaths(orderBy, this.alias)

    // Take the `n` items after the biggest sent value
    // Pass the current window offset to ensure proper deduplication
    subscription.requestLimitedSnapshot({
      orderBy: normalizedOrderBy,
      limit: n,
      minValues,
      // Omit offset so requestLimitedSnapshot can advance the offset based on
      // the number of rows already loaded (supports offset-based backends).
      trackLoadSubsetPromise: false,
      onLoadSubsetResult: this.orderedLoadSubsetResult,
    })

    this.lastLoadRequestKey = loadRequestKey
  }

  private getWhereClauseForAlias(): BasicExpression<boolean> | undefined {
    const sourceWhereClausesCache =
      this.collectionConfigBuilder.sourceWhereClausesCache
    if (!sourceWhereClausesCache) {
      return undefined
    }
    return sourceWhereClausesCache.get(this.alias)
  }

  private getOrderByInfo(): OrderByOptimizationInfo | undefined {
    const info =
      this.collectionConfigBuilder.optimizableOrderByCollections[
        this.collectionId
      ]
    if (info && info.alias === this.alias) {
      return info
    }
    return undefined
  }

  private trackSentValues(
    changes: Array<ChangeMessage<any, string | number>>,
    comparator: (a: any, b: any) => number,
  ): void {
    for (const change of changes) {
      if (change.type === `delete`) {
        continue
      }

      const isNewKey = !this.sentToD2Keys.has(change.key)

      // Only track inserts/updates for cursor positioning, not deletes
      if (!this.biggest) {
        this.biggest = change.value
        this.lastLoadRequestKey = undefined
      } else if (comparator(this.biggest, change.value) < 0) {
        this.biggest = change.value
        this.lastLoadRequestKey = undefined
      } else if (isNewKey) {
        // New key with same orderBy value - allow another load if needed
        this.lastLoadRequestKey = undefined
      }
    }
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
    this.collectionConfigBuilder.liveQueryCollection!._sync.trackLoadPromise(
      promise,
    )
  }

  private getLoadRequestKey(options: {
    minValues: Array<unknown> | undefined
    offset: number
    limit: number
  }): string {
    return serializeValue({
      minValues: options.minValues ?? null,
      offset: options.offset,
      limit: options.limit,
    })
  }
}

