import { ensureIndexForExpression } from "../indexes/auto-index.js"
import { and, eq, gt, lt } from "../query/builder/functions.js"
import { Value } from "../query/ir.js"
import { EventEmitter } from "../event-emitter.js"
import {
  createFilterFunctionFromExpression,
  createFilteredCallback,
} from "./change-events.js"
import type { BasicExpression, OrderBy } from "../query/ir.js"
import type { IndexInterface } from "../indexes/base-index.js"
import type {
  ChangeMessage,
  LoadSubsetOptions,
  Subscription,
  SubscriptionEvents,
  SubscriptionStatus,
  SubscriptionUnsubscribedEvent,
} from "../types.js"
import type { CollectionImpl } from "./index.js"

type RequestSnapshotOptions = {
  where?: BasicExpression<boolean>
  optimizedOnly?: boolean
  trackLoadSubsetPromise?: boolean
}

type RequestLimitedSnapshotOptions = {
  orderBy: OrderBy
  limit: number
  minValue?: any
}

type CollectionSubscriptionOptions = {
  includeInitialState?: boolean
  /** Pre-compiled expression for filtering changes */
  whereExpression?: BasicExpression<boolean>
  /** Callback to call when the subscription is unsubscribed */
  onUnsubscribe?: (event: SubscriptionUnsubscribedEvent) => void
}

export class CollectionSubscription
  extends EventEmitter<SubscriptionEvents>
  implements Subscription
{
  private loadedInitialState = false

  // Flag to indicate that we have sent at least 1 snapshot.
  // While `snapshotSent` is false we filter out all changes from subscription to the collection.
  private snapshotSent = false

  // Track all loadSubset calls made by this subscription so we can unload them on cleanup
  private loadedSubsets: Array<LoadSubsetOptions> = []

  // Keep track of the keys we've sent (needed for join and orderBy optimizations)
  private sentKeys = new Set<string | number>()

  private filteredCallback: (changes: Array<ChangeMessage<any, any>>) => void

  private orderByIndex: IndexInterface<string | number> | undefined

  // Status tracking
  private _status: SubscriptionStatus = `ready`
  private pendingLoadSubsetPromises: Set<Promise<void>> = new Set()

  public get status(): SubscriptionStatus {
    return this._status
  }

  constructor(
    private collection: CollectionImpl<any, any, any, any, any>,
    private callback: (changes: Array<ChangeMessage<any, any>>) => void,
    private options: CollectionSubscriptionOptions
  ) {
    super()
    if (options.onUnsubscribe) {
      this.on(`unsubscribed`, (event) => options.onUnsubscribe!(event))
    }

    // Auto-index for where expressions if enabled
    if (options.whereExpression) {
      ensureIndexForExpression(options.whereExpression, this.collection)
    }

    const callbackWithSentKeysTracking = (
      changes: Array<ChangeMessage<any, any>>
    ) => {
      callback(changes)
      this.trackSentKeys(changes)
    }

    this.callback = callbackWithSentKeysTracking

    // Create a filtered callback if where clause is provided
    this.filteredCallback = options.whereExpression
      ? createFilteredCallback(this.callback, options)
      : this.callback
  }

  setOrderByIndex(index: IndexInterface<any>) {
    this.orderByIndex = index
  }

  /**
   * Set subscription status and emit events if changed
   */
  private setStatus(newStatus: SubscriptionStatus) {
    if (this._status === newStatus) {
      return // No change
    }

    const previousStatus = this._status
    this._status = newStatus

    // Emit status:change event
    this.emitInner(`status:change`, {
      type: `status:change`,
      subscription: this,
      previousStatus,
      status: newStatus,
    })

    // Emit specific status event
    const eventKey: `status:${SubscriptionStatus}` = `status:${newStatus}`
    this.emitInner(eventKey, {
      type: eventKey,
      subscription: this,
      previousStatus,
      status: newStatus,
    } as SubscriptionEvents[typeof eventKey])
  }

  /**
   * Track a loadSubset promise and manage loading status
   */
  private trackLoadSubsetPromise(syncResult: Promise<void> | true) {
    // Track the promise if it's actually a promise (async work)
    if (syncResult instanceof Promise) {
      this.pendingLoadSubsetPromises.add(syncResult)
      this.setStatus(`loadingSubset`)

      syncResult.finally(() => {
        this.pendingLoadSubsetPromises.delete(syncResult)
        if (this.pendingLoadSubsetPromises.size === 0) {
          this.setStatus(`ready`)
        }
      })
    }
  }

  hasLoadedInitialState() {
    return this.loadedInitialState
  }

  hasSentAtLeastOneSnapshot() {
    return this.snapshotSent
  }

  emitEvents(changes: Array<ChangeMessage<any, any>>) {
    const newChanges = this.filterAndFlipChanges(changes)
    this.filteredCallback(newChanges)
  }

  /**
   * Sends the snapshot to the callback.
   * Returns a boolean indicating if it succeeded.
   * It can only fail if there is no index to fulfill the request
   * and the optimizedOnly option is set to true,
   * or, the entire state was already loaded.
   */
  requestSnapshot(opts?: RequestSnapshotOptions): boolean {
    if (this.loadedInitialState) {
      // Subscription was deoptimized so we already sent the entire initial state
      return false
    }

    const stateOpts: RequestSnapshotOptions = {
      where: this.options.whereExpression,
      optimizedOnly: opts?.optimizedOnly ?? false,
    }

    if (opts) {
      if (`where` in opts) {
        const snapshotWhereExp = opts.where
        if (stateOpts.where) {
          // Combine the two where expressions
          const subWhereExp = stateOpts.where
          const combinedWhereExp = and(subWhereExp, snapshotWhereExp)
          stateOpts.where = combinedWhereExp
        } else {
          stateOpts.where = snapshotWhereExp
        }
      }
    } else {
      // No options provided so it's loading the entire initial state
      this.loadedInitialState = true
    }

    // Request the sync layer to load more data
    // don't await it, we will load the data into the collection when it comes in
    const loadOptions = {
      where: stateOpts.where,
      subscription: this,
    }
    const syncResult = this.collection._sync.loadSubset(loadOptions)

    // Track this loadSubset call so we can unload it later
    this.loadedSubsets.push({ where: stateOpts.where })

    const trackLoadSubsetPromise = opts?.trackLoadSubsetPromise ?? true
    if (trackLoadSubsetPromise) {
      this.trackLoadSubsetPromise(syncResult)
    }

    // Also load data immediately from the collection
    const snapshot = this.collection.currentStateAsChanges(stateOpts)

    if (snapshot === undefined) {
      // Couldn't load from indexes
      return false
    }

    // Only send changes that have not been sent yet
    const filteredSnapshot = snapshot.filter(
      (change) => !this.sentKeys.has(change.key)
    )

    this.snapshotSent = true
    this.callback(filteredSnapshot)
    return true
  }

  /**
   * Sends a snapshot that fulfills the `where` clause and all rows are bigger or equal to `minValue`.
   * Requires a range index to be set with `setOrderByIndex` prior to calling this method.
   * It uses that range index to load the items in the order of the index.
   * Note 1: it may load more rows than the provided LIMIT because it loads all values equal to `minValue` + limit values greater than `minValue`.
   *         This is needed to ensure that it does not accidentally skip duplicate values when the limit falls in the middle of some duplicated values.
   * Note 2: it does not send keys that have already been sent before.
   */
  requestLimitedSnapshot({
    orderBy,
    limit,
    minValue,
  }: RequestLimitedSnapshotOptions) {
    if (!limit) throw new Error(`limit is required`)

    if (!this.orderByIndex) {
      throw new Error(
        `Ordered snapshot was requested but no index was found. You have to call setOrderByIndex before requesting an ordered snapshot.`
      )
    }

    const index = this.orderByIndex
    const where = this.options.whereExpression
    const whereFilterFn = where
      ? createFilterFunctionFromExpression(where)
      : undefined

    const filterFn = (key: string | number): boolean => {
      if (this.sentKeys.has(key)) {
        return false
      }

      const value = this.collection.get(key)
      if (value === undefined) {
        return false
      }

      return whereFilterFn?.(value) ?? true
    }

    let biggestObservedValue = minValue
    const changes: Array<ChangeMessage<any, string | number>> = []

    // If we have a minValue we need to handle the case
    // where there might be duplicate values equal to minValue that we need to include
    // because we can have data like this: [1, 2, 3, 3, 3, 4, 5]
    // so if minValue is 3 then the previous snapshot may not have included all 3s
    // e.g. if it was offset 0 and limit 3 it would only have loaded the first 3
    //      so we load all rows equal to minValue first, to be sure we don't skip any duplicate values
    let keys: Array<string | number> = []
    if (minValue !== undefined) {
      // First, get all items with the same value as minValue
      const { expression } = orderBy[0]!
      const allRowsWithMinValue = this.collection.currentStateAsChanges({
        where: eq(expression, new Value(minValue)),
      })

      if (allRowsWithMinValue) {
        const keysWithMinValue = allRowsWithMinValue
          .map((change) => change.key)
          .filter((key) => !this.sentKeys.has(key) && filterFn(key))

        // Add items with the minValue first
        keys.push(...keysWithMinValue)

        // Then get items greater than minValue
        const keysGreaterThanMin = index.take(
          limit - keys.length,
          minValue,
          filterFn
        )
        keys.push(...keysGreaterThanMin)
      } else {
        keys = index.take(limit, minValue, filterFn)
      }
    } else {
      keys = index.take(limit, minValue, filterFn)
    }

    const valuesNeeded = () => Math.max(limit - changes.length, 0)
    const collectionExhausted = () => keys.length === 0

    while (valuesNeeded() > 0 && !collectionExhausted()) {
      const insertedKeys = new Set<string | number>() // Track keys we add to `changes` in this iteration

      for (const key of keys) {
        const value = this.collection.get(key)!
        changes.push({
          type: `insert`,
          key,
          value,
        })
        biggestObservedValue = value
        insertedKeys.add(key) // Track this key
      }

      keys = index.take(valuesNeeded(), biggestObservedValue, filterFn)
    }

    this.callback(changes)

    let whereWithValueFilter = where
    if (typeof minValue !== `undefined`) {
      // Only request data that we haven't seen yet (i.e. is bigger than the minValue)
      const { expression, compareOptions } = orderBy[0]!
      const operator = compareOptions.direction === `asc` ? gt : lt
      const valueFilter = operator(expression, new Value(minValue))
      whereWithValueFilter = where ? and(where, valueFilter) : valueFilter
    }

    // Request the sync layer to load more data
    // don't await it, we will load the data into the collection when it comes in
    const loadOptions1 = {
      where: whereWithValueFilter,
      limit,
      orderBy,
      subscription: this,
    }
    const syncResult = this.collection._sync.loadSubset(loadOptions1)

    // Track this loadSubset call
    this.loadedSubsets.push({ where: whereWithValueFilter, limit, orderBy })

    // Make parallel loadSubset calls for values equal to minValue and values greater than minValue
    const promises: Array<Promise<void>> = []

    // First promise: load all values equal to minValue
    if (typeof minValue !== `undefined`) {
      const { expression } = orderBy[0]!
      const exactValueFilter = eq(expression, new Value(minValue))

      const loadOptions2 = {
        where: exactValueFilter,
        subscription: this,
      }
      const equalValueResult = this.collection._sync.loadSubset(loadOptions2)

      // Track this loadSubset call
      this.loadedSubsets.push({ where: exactValueFilter })

      if (equalValueResult instanceof Promise) {
        promises.push(equalValueResult)
      }
    }

    // Second promise: load values greater than minValue
    if (syncResult instanceof Promise) {
      promises.push(syncResult)
    }

    // Track the combined promise
    if (promises.length > 0) {
      const combinedPromise = Promise.all(promises).then(() => {})
      this.trackLoadSubsetPromise(combinedPromise)
    } else {
      this.trackLoadSubsetPromise(syncResult)
    }
  }

  // TODO: also add similar test but that checks that it can also load it from the collection's loadSubset function
  //       and that that also works properly (i.e. does not skip duplicate values)

  /**
   * Filters and flips changes for keys that have not been sent yet.
   * Deletes are filtered out for keys that have not been sent yet.
   * Updates are flipped into inserts for keys that have not been sent yet.
   */
  private filterAndFlipChanges(changes: Array<ChangeMessage<any, any>>) {
    if (this.loadedInitialState) {
      // We loaded the entire initial state
      // so no need to filter or flip changes
      return changes
    }

    const newChanges = []
    for (const change of changes) {
      let newChange = change
      if (!this.sentKeys.has(change.key)) {
        if (change.type === `update`) {
          newChange = { ...change, type: `insert`, previousValue: undefined }
        } else if (change.type === `delete`) {
          // filter out deletes for keys that have not been sent
          continue
        }
        this.sentKeys.add(change.key)
      }
      newChanges.push(newChange)
    }
    return newChanges
  }

  private trackSentKeys(changes: Array<ChangeMessage<any, string | number>>) {
    if (this.loadedInitialState) {
      // No need to track sent keys if we loaded the entire state.
      // Since we sent everything, all keys must have been observed.
      return
    }

    for (const change of changes) {
      this.sentKeys.add(change.key)
    }
  }

  unsubscribe() {
    // Unload all subsets that this subscription loaded
    for (const subset of this.loadedSubsets) {
      this.collection._sync.unloadSubset({
        ...subset,
        subscription: this,
      })
    }
    this.loadedSubsets = []

    this.emitInner(`unsubscribed`, {
      type: `unsubscribed`,
      subscription: this,
    })
    // Clear all event listeners to prevent memory leaks
    this.clearListeners()
  }
}
