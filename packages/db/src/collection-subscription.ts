import type { Collection } from "./collection.js"
import type { ChangeMessage } from "./types.js"
import { OrderBy, type BasicExpression } from "./query/ir.js"
import { createFilteredCallback } from "./change-events.js"
import { ensureIndexForExpression } from "./indexes/auto-index.js"
import { and } from "./query/index.js"

type RequestSnapshotOptions = {
  where?: BasicExpression<boolean>
  orderBy?: OrderBy
  limit?: number
  optimizedOnly?: boolean
}
    
type CollectionSubscriptionOptions = {
  /** Pre-compiled expression for filtering changes */
  whereExpression?: BasicExpression<boolean>
  /** Callback to call when the subscription is unsubscribed */
  onUnsubscribe?: () => void
}

export class CollectionSubscription {
  private loadedInitialState = false

  // Flag to indicate that we have sent at least 1 snapshot.
  // While `snapshotSent` is false we filter out all changes from subscription to the collection.
  private snapshotSent = false

  // Keep track of the keys we've sent (needed for join and orderBy optimizations)
  private sentKeys = new Set<string | number>()

  private filteredCallback: (changes: Array<ChangeMessage<any, any>>) => void

  constructor(
    private collection: Collection<any, any, any, any, any>,
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

  hasLoadedInitialState() {
    return this.loadedInitialState
  }

  hasSentAtLeastOneSnapshot() {
    return this.snapshotSent
  }

  emitEvents(changes: Array<ChangeMessage<any, any>>) {
    const newChanges = this.filterAndFlipChanges(changes)
    console.log("subscription.emitEvents, og changes: ", JSON.stringify(changes, null, 2))
    console.log("subscription.emitEvents, new changes: ", JSON.stringify(newChanges, null, 2))
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
    // TODO: i don't think we should short circuit here
    //       because we may need to request more data even after having loaded the entire state?
    //       --> no maybe we never do this
    if (this.loadedInitialState) {
      // Subscription was deoptimized so we already sent the entire initial state
      return false
    }

    let stateOpts: RequestSnapshotOptions = {
      where: this.options.whereExpression,
      optimizedOnly: opts?.optimizedOnly ?? false,
    }

    if (opts) {
      if ("where" in opts) {
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

      if ("orderBy" in opts) {
        stateOpts.orderBy = opts.orderBy

        if ("limit" in opts) {
          stateOpts.limit = opts.limit
        }
      }
    } else {
      // No options provided so it's loading the entire initial state
      this.loadedInitialState = true
    }

    // TODO: Then modify currentStateAsChanges to handle the orderBy and limit options
    //       because those changes will be needed for the orderBy optimization

    const snapshot = this.collection.currentStateAsChanges(stateOpts)

    if (snapshot === undefined) {
      // Couldn't load from indexes
      return false
    }

    // Only send changes that have not been sent yet
    const filteredSnapshot = snapshot.filter(
      (change) => !this.sentKeys.has(change.key)
    )

    // TODO: we have to check what we need to do here: send filteredSnapshot or entire snapshot?
    //       if i sent entire snapshot then we get errors because a key already exists in the collection
    //       if i sent filteredSnapshot then join breaks because join requests a snapshot
    //       for matching keys but then it doesn't receive the matching keys because it has already been sent
    //       --> but how come it has already been sent?
    // SOLUTION: the reason is because in `subscribeToMatchingChanges` we only send the changes if subscription.hasSentAtLeastOneSnapshot()
    //           but in here we will track it as if we have sent it, so this subscription should have an option to
    //           track only after it has sent the first snapshot (so we can provide trackBeforeFirstSnapshot: false)
    //           to disable this behavior

    this.snapshotSent = true
    console.log("og snapshot: ", JSON.stringify(snapshot, null, 2))
    console.log("Sending snapshot: ", JSON.stringify(filteredSnapshot, null, 2))
    this.callback(filteredSnapshot)
    return true
  }

  /**
   * Filters and flips changes for keys that have not been sent yet.
   * Deletes are filtered out for keys that have not been sent yet.
   * Updates are flipped into inserts for keys that have not been sent yet.
   */
  filterAndFlipChanges(changes: Array<ChangeMessage<any, any>>) {
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
    this.options.onUnsubscribe?.()
  }
}
