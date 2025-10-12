import { ensureIndexForExpression } from "../indexes/auto-index.js"
import { and, gt, lt } from "../query/builder/functions.js"
import { Value } from "../query/ir.js"
import {
  createFilterFunctionFromExpression,
  createFilteredCallback,
} from "./change-events.js"
import type { BasicExpression, OrderBy } from "../query/ir.js"
import type { IndexInterface } from "../indexes/base-index.js"
import type { ChangeMessage } from "../types.js"
import type { CollectionImpl } from "./index.js"

type RequestSnapshotOptions = {
  where?: BasicExpression<boolean>
  optimizedOnly?: boolean
}

type RequestLimitedSnapshotOptions = {
  orderBy: OrderBy
  limit: number
  minValue?: any
}

type CollectionSubscriptionOptions = {
  /** Pre-compiled expression for filtering changes */
  whereExpression?: BasicExpression<boolean>
  /** Callback to call when the subscription is unsubscribed */
  onUnsubscribe?: () => void
}

type SubscriptionStatus = `ready` | `loadingMore`

interface SubscriptionStatusChangeEvent {
  type: `status:change`
  subscription: CollectionSubscription
  previousStatus: SubscriptionStatus
  status: SubscriptionStatus
}

interface SubscriptionStatusEvent<T extends SubscriptionStatus> {
  type: `status:${T}`
  subscription: CollectionSubscription
  previousStatus: SubscriptionStatus
  status: T
}

type AllSubscriptionEvents = {
  "status:change": SubscriptionStatusChangeEvent
  "status:ready": SubscriptionStatusEvent<`ready`>
  "status:loadingMore": SubscriptionStatusEvent<`loadingMore`>
}

type SubscriptionEventHandler<T extends keyof AllSubscriptionEvents> = (
  event: AllSubscriptionEvents[T]
) => void

export class CollectionSubscription {
  private loadedInitialState = false

  // Flag to indicate that we have sent at least 1 snapshot.
  // While `snapshotSent` is false we filter out all changes from subscription to the collection.
  private snapshotSent = false

  // Keep track of the keys we've sent (needed for join and orderBy optimizations)
  private sentKeys = new Set<string | number>()

  private filteredCallback: (changes: Array<ChangeMessage<any, any>>) => void

  private orderByIndex: IndexInterface<string | number> | undefined

  // Status tracking
  public status: SubscriptionStatus = `ready`
  private pendingLoadMorePromises: Set<Promise<void>> = new Set()

  // Event emitter
  private listeners = new Map<
    keyof AllSubscriptionEvents,
    Set<SubscriptionEventHandler<any>>
  >()

  constructor(
    private collection: CollectionImpl<any, any, any, any, any>,
    private callback: (changes: Array<ChangeMessage<any, any>>) => void,
    private options: CollectionSubscriptionOptions
  ) {
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
   * Subscribe to a subscription event
   */
  on<T extends keyof AllSubscriptionEvents>(
    event: T,
    callback: SubscriptionEventHandler<T>
  ) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)

    return () => {
      this.listeners.get(event)?.delete(callback)
    }
  }

  /**
   * Subscribe to a subscription event once
   */
  once<T extends keyof AllSubscriptionEvents>(
    event: T,
    callback: SubscriptionEventHandler<T>
  ) {
    const unsubscribe = this.on(event, (eventPayload) => {
      callback(eventPayload)
      unsubscribe()
    })
    return unsubscribe
  }

  /**
   * Unsubscribe from a subscription event
   */
  off<T extends keyof AllSubscriptionEvents>(
    event: T,
    callback: SubscriptionEventHandler<T>
  ) {
    this.listeners.get(event)?.delete(callback)
  }

  /**
   * Emit a subscription event
   */
  private emit<T extends keyof AllSubscriptionEvents>(
    event: T,
    eventPayload: AllSubscriptionEvents[T]
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

  /**
   * Set subscription status and emit events if changed
   */
  private setStatus(newStatus: SubscriptionStatus) {
    if (this.status === newStatus) {
      return // No change
    }

    const previousStatus = this.status
    this.status = newStatus

    // Emit status:change event
    this.emit(`status:change`, {
      type: `status:change`,
      subscription: this,
      previousStatus,
      status: newStatus,
    })

    // Emit specific status event
    const eventKey: `status:${SubscriptionStatus}` = `status:${newStatus}`
    this.emit(eventKey, {
      type: eventKey,
      subscription: this,
      previousStatus,
      status: newStatus,
    } as AllSubscriptionEvents[typeof eventKey])
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
    const syncPromise = this.collection.syncMore({
      where: stateOpts.where,
    })

    // Track the promise if it exists
    if (syncPromise) {
      this.pendingLoadMorePromises.add(syncPromise)
      this.setStatus(`loadingMore`)

      syncPromise.finally(() => {
        this.pendingLoadMorePromises.delete(syncPromise)
        if (this.pendingLoadMorePromises.size === 0) {
          this.setStatus(`ready`)
        }
      })
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
   * Sends a snapshot that is limited to the first `limit` rows that fulfill the `where` clause and are bigger than `minValue`.
   * Requires a range index to be set with `setOrderByIndex` prior to calling this method.
   * It uses that range index to load the items in the order of the index.
   * Note: it does not send keys that have already been sent before.
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
    let keys: Array<string | number> = index.take(limit, minValue, filterFn)

    const valuesNeeded = () => Math.max(limit - changes.length, 0)
    const collectionExhausted = () => keys.length === 0

    while (valuesNeeded() > 0 && !collectionExhausted()) {
      for (const key of keys) {
        const value = this.collection.get(key)!
        changes.push({
          type: `insert`,
          key,
          value,
        })
        biggestObservedValue = value
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
    const syncPromise = this.collection.syncMore({
      where: whereWithValueFilter,
      limit,
      orderBy,
    })

    // Track the promise if it exists
    if (syncPromise) {
      this.pendingLoadMorePromises.add(syncPromise)
      this.setStatus(`loadingMore`)

      syncPromise.finally(() => {
        this.pendingLoadMorePromises.delete(syncPromise)
        if (this.pendingLoadMorePromises.size === 0) {
          this.setStatus(`ready`)
        }
      })
    }
  }

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
    // Clear all event listeners to prevent memory leaks
    this.listeners.clear()
    this.options.onUnsubscribe?.()
  }
}
