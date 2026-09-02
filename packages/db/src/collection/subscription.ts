import { ensureIndexForExpression } from '../indexes/auto-index.js'
import { and, eq, gte, lt } from '../query/builder/functions.js'
import { PropRef, Value } from '../query/ir.js'
import { EventEmitter } from '../event-emitter.js'
import { compileExpression } from '../query/compiler/evaluators.js'
import { buildCursor } from '../utils/cursor.js'
import { deepEquals } from '../utils.js'
import {
  createFilterFunctionFromExpression,
  createFilteredCallback,
} from './change-events.js'
import type { BasicExpression, OrderBy } from '../query/ir.js'
import type { IndexInterface } from '../indexes/base-index.js'
import type {
  ChangeMessage,
  LoadSubsetOptions,
  LoadSubsetRequestResult,
  Subscription,
  SubscriptionEvents,
  SubscriptionLoadSubsetErrorEvent,
  SubscriptionStatus,
  SubscriptionUnsubscribedEvent,
} from '../types.js'
import type { CollectionImpl } from './index.js'

type RequestSnapshotOptions = {
  where?: BasicExpression<boolean>
  signal?: AbortSignal
  optimizedOnly?: boolean
  trackLoadSubsetPromise?: boolean
  /** Optional orderBy to pass to loadSubset for backend optimization */
  orderBy?: OrderBy
  /** Optional limit to pass to loadSubset for backend optimization */
  limit?: number
  /** Callback that receives the normalized loadSubset result for internal tracking */
  onLoadSubsetResult?: (result: LoadSubsetRequestResult) => void
  /** Called when the local snapshot must fall back from an index to a scan. */
  onUnoptimized?: () => void
}

type RequestLimitedSnapshotOptions = {
  orderBy: OrderBy
  limit: number
  /** All column values for cursor (first value used for local index, all values for sync layer) */
  minValues?: Array<unknown>
  /** Row offset for offset-based pagination (passed to sync layer) */
  offset?: number
  /** Whether to track the loadSubset promise on this subscription (default: true) */
  trackLoadSubsetPromise?: boolean
  /** Callback that receives the normalized loadSubset result for internal tracking */
  onLoadSubsetResult?: (result: LoadSubsetRequestResult) => void
}

type CollectionSubscriptionOptions = {
  includeInitialState?: boolean
  /** Pre-compiled expression for filtering changes */
  whereExpression?: BasicExpression<boolean>
  /** Callback to call when the subscription is unsubscribed */
  onUnsubscribe?: (event: SubscriptionUnsubscribedEvent) => void
  /** Callback for subset-load failures scoped to this subscription. */
  onLoadSubsetError?: (event: SubscriptionLoadSubsetErrorEvent) => void
}

type TruncatePublicationState = {
  loadedInitialState: boolean
  snapshotSent: boolean
  sentKeys: Set<string | number>
  publishedRows: Map<string | number, object>
  limitedSnapshotRowCount: number
  lastSentKey: string | number | undefined
}

type SubsetAcquisition = {
  options: LoadSubsetOptions
  abortController?: AbortController
  removeRequestAbortListener?: () => void
}

type SubsetDemand = SubsetAcquisition & {
  requestOptions: LoadSubsetOptions
  releaseFailed: boolean
}

type TruncateReplayAttempt = {
  pending: Set<{ promise: Promise<unknown> }>
  failed: boolean
  setupComplete: boolean
}

type TruncateReplaySession = {
  publicationState: TruncatePublicationState
  buffer: Array<Array<ChangeMessage<any, any>>>
  attempts: Set<TruncateReplayAttempt>
  currentAttempt: TruncateReplayAttempt
}

export class CollectionSubscription
  extends EventEmitter<SubscriptionEvents>
  implements Subscription
{
  private loadedInitialState = false

  // Flag to skip filtering in filterAndFlipChanges.
  // This is separate from loadedInitialState because we want to allow
  // requestSnapshot to still work even when filtering is skipped.
  private skipFiltering = false

  // Flag to indicate that we have sent at least 1 snapshot.
  // While `snapshotSent` is false we filter out all changes from subscription to the collection.
  private snapshotSent = false

  /**
   * Track all loadSubset calls made by this subscription so we can unload them on cleanup.
   * We store the exact LoadSubsetOptions we passed to loadSubset to ensure symmetric unload.
   */
  private subsetDemands: Array<SubsetDemand> = []
  private readonly requestedSubsetWhere = new WeakMap<
    LoadSubsetOptions,
    BasicExpression<boolean>
  >()

  // Keep track of the keys we've sent (needed for join and orderBy optimizations)
  private sentKeys = new Set<string | number>()
  private publishedRows = new Map<string | number, object>()
  private stalePublishedRows = new Map<string | number, object>()

  // Track the count of rows sent via requestLimitedSnapshot for offset-based pagination
  private limitedSnapshotRowCount = 0

  // Track the last key sent via requestLimitedSnapshot for cursor-based pagination
  private lastSentKey: string | number | undefined

  private filteredCallback: (changes: Array<ChangeMessage<any, any>>) => boolean

  private orderByIndex: IndexInterface<string | number> | undefined

  // Status tracking
  private _status: SubscriptionStatus = `ready`
  private _lastError: unknown | undefined
  private pendingLoadSubsetPromises: Set<Promise<unknown>> = new Set()

  // Cleanup function for truncate event listener
  private truncateCleanup: (() => void) | undefined

  // One replay session owns the publication baseline, overlapping attempts,
  // and buffered changes until every attempt settles.
  private truncateReplaySession: TruncateReplaySession | undefined

  public get status(): SubscriptionStatus {
    return this._status
  }

  public get lastError(): unknown | undefined {
    return this._lastError
  }

  constructor(
    private collection: CollectionImpl<any, any, any, any, any>,
    private callback: (changes: Array<ChangeMessage<any, any>>) => void,
    private options: CollectionSubscriptionOptions,
  ) {
    super()
    if (options.onUnsubscribe) {
      this.on(`unsubscribed`, options.onUnsubscribe)
    }
    if (options.onLoadSubsetError) {
      this.on(`loadSubset:error`, options.onLoadSubsetError)
    }

    // Auto-index for where expressions if enabled
    if (options.whereExpression) {
      ensureIndexForExpression(options.whereExpression, this.collection)
    }

    const callbackWithSentKeysTracking = (
      changes: Array<ChangeMessage<any, any>>,
    ) => {
      this.trackPublishedRows(changes)
      this.trackSentKeys(changes)
      callback(changes)
    }

    this.callback = callbackWithSentKeysTracking

    // Create a filtered callback if where clause is provided
    this.filteredCallback = options.whereExpression
      ? createFilteredCallback(this.callback, options)
      : (changes) => {
          this.callback(changes)
          return true
        }

    // Listen for truncate events to re-request data after must-refetch
    // When a truncate happens (e.g., from a 409 must-refetch), all collection data is cleared.
    // We need to re-request all previously loaded subsets to repopulate the data.
    this.truncateCleanup = this.collection.on(`truncate`, () => {
      this.handleTruncate()
    })
  }

  /**
   * Handle collection truncate event by resetting state and re-requesting subsets.
   * This is called when the sync layer receives a must-refetch and clears all data.
   *
   * To prevent a flash of missing content, we buffer all changes (deletes from truncate
   * and inserts from refetch) until all loadSubset calls succeed, then emit them together.
   * A failed replay keeps the last published snapshot, resumes ordinary deltas,
   * and retains subset ownership so a later truncate can retry the replay.
   */
  private handleTruncate() {
    const demandsToReload = [...this.subsetDemands]

    // Only buffer if there's an actual loadSubset handler that can do async work.
    // Without a loadSubset handler, there's nothing to re-request and no reason to buffer.
    // This prevents unnecessary buffering in eager sync mode or when loadSubset isn't implemented.
    const hasLoadSubsetHandler = this.collection._sync.syncLoadSubsetFn !== null

    // If there are no subsets to reload OR no loadSubset handler, just reset state
    if (demandsToReload.length === 0 || !hasLoadSubsetHandler) {
      this.snapshotSent = false
      this.loadedInitialState = false
      this.limitedSnapshotRowCount = 0
      this.lastSentKey = undefined
      return
    }

    const attempt: TruncateReplayAttempt = {
      pending: new Set(),
      failed: false,
      setupComplete: false,
    }
    let session = this.truncateReplaySession
    if (!session) {
      session = {
        publicationState: {
          loadedInitialState: this.loadedInitialState,
          snapshotSent: this.snapshotSent,
          sentKeys: new Set(this.sentKeys),
          publishedRows: new Map(this.publishedRows),
          limitedSnapshotRowCount: this.limitedSnapshotRowCount,
          lastSentKey: this.lastSentKey,
        },
        buffer: [],
        attempts: new Set(),
        currentAttempt: attempt,
      }
      this.truncateReplaySession = session
    }
    session.attempts.add(attempt)
    session.currentAttempt = attempt

    // A newer replay replaces every prior acquisition for these demands. Abort
    // the old work before it can install rows into the new generation.
    for (const demand of demandsToReload) {
      demand.abortController?.abort()
    }

    // Start buffering before the truncate commit publishes its deletes. Every
    // overlapping attempt shares this one publication baseline and buffer.
    // Retained rows from an earlier failed replay stay marked until this
    // attempt either replaces them or proves they are absent.

    // Reset snapshot/pagination tracking state for the replacement snapshot.
    this.snapshotSent = false
    this.loadedInitialState = false
    this.limitedSnapshotRowCount = 0
    this.lastSentKey = undefined

    // Defer the requests so the truncate commit's deletes enter the session
    // buffer before a synchronous adapter can publish replacement rows.
    queueMicrotask(() => {
      if (this.truncateReplaySession !== session) return

      for (const demand of demandsToReload) {
        if (!this.subsetDemands.includes(demand)) continue

        const isCurrentAttempt = () =>
          this.truncateReplaySession === session &&
          session.currentAttempt === attempt
        const nextAcquisition = this.createSubsetAcquisition(demand)
        let syncResult: LoadSubsetRequestResult
        try {
          syncResult = this.loadSubset(
            nextAcquisition.options,
            isCurrentAttempt,
          )
        } catch {
          nextAcquisition.abortController.abort()
          nextAcquisition.removeRequestAbortListener?.()
          attempt.failed = true
          continue
        }

        this.observeLoadSubsetResult(
          syncResult,
          nextAcquisition.options,
          true,
          () => isCurrentAttempt() && !nextAcquisition.options.signal?.aborted,
        )

        if (syncResult instanceof Promise) {
          // A transport promise may be shared by several deduplicated logical
          // demands. Track each demand separately so one settlement observer
          // cannot complete the attempt before the others apply their result.
          const pending = { promise: syncResult }
          attempt.pending.add(pending)
          void syncResult.then(
            () => this.settleTruncateReplay(session, attempt, pending),
            () => {
              // A released demand no longer participates in the current
              // replacement. Its cooperative AbortError must not discard the
              // successful rows from demands that are still active.
              if (
                this.subsetDemands.includes(demand) &&
                !nextAcquisition.options.signal?.aborted
              ) {
                attempt.failed = true
              }
              this.settleTruncateReplay(session, attempt, pending)
            },
          )
        }

        try {
          this.replaceSubsetAcquisition(demand, nextAcquisition)
        } catch (error) {
          // The old lease is still owned because its release failed. Abort and
          // release the new acquisition, but keep observing its work so rows
          // from a non-cooperative adapter cannot escape the replay buffer.
          nextAcquisition.abortController.abort()
          nextAcquisition.removeRequestAbortListener?.()
          try {
            this.collection._sync.unloadSubset(nextAcquisition.options)
          } catch {
            // Preserve the first ownership error. The demand still retains the
            // old acquisition so normal cleanup can retry that release.
          }
          this.recordLoadSubsetError(demand.options, error, true)
          attempt.failed = true
        }
      }

      attempt.setupComplete = true
      this.checkTruncateReplayComplete(session)
    })
  }

  private settleTruncateReplay(
    session: TruncateReplaySession,
    attempt: TruncateReplayAttempt,
    pending: { promise: Promise<unknown> },
  ): void {
    if (this.truncateReplaySession !== session) return
    attempt.pending.delete(pending)
    this.checkTruncateReplayComplete(session)
  }

  /** Publish only after every overlapping replay attempt has settled. */
  private checkTruncateReplayComplete(session: TruncateReplaySession): void {
    if (this.truncateReplaySession !== session) return
    for (const attempt of session.attempts) {
      if (!attempt.setupComplete || attempt.pending.size > 0) return
    }

    if (session.currentAttempt.failed) {
      this.abandonTruncateReplay(session)
    } else {
      this.flushTruncateReplay(session)
    }
  }

  /**
   * Discard an incomplete current replay and restore the last publication.
   * Rows in that publication remain stale until a later source delta or replay
   * reconciles them with the source collection.
   */
  private abandonTruncateReplay(session: TruncateReplaySession): void {
    if (this.truncateReplaySession !== session) return
    const publicationState = session.publicationState
    this.loadedInitialState = publicationState.loadedInitialState
    this.snapshotSent = publicationState.snapshotSent
    this.sentKeys = new Set(publicationState.sentKeys)
    this.publishedRows = new Map(publicationState.publishedRows)
    this.stalePublishedRows = new Map(publicationState.publishedRows)
    this.limitedSnapshotRowCount = publicationState.limitedSnapshotRowCount
    this.lastSentKey = publicationState.lastSentKey
    this.truncateReplaySession = undefined
  }

  /** Publish the complete buffered replacement as one subscriber batch. */
  private flushTruncateReplay(session: TruncateReplaySession): void {
    if (this.truncateReplaySession !== session) return
    this.truncateReplaySession = undefined

    const retainedDeletes = [...this.stalePublishedRows].map(
      ([key, value]): ChangeMessage<any, any> => ({
        type: `delete`,
        key,
        value,
      }),
    )
    this.stalePublishedRows.clear()

    const merged = [...session.buffer.flat(), ...retainedDeletes]
    const activeDemandFilters = this.subsetDemands.map((demand) =>
      demand.requestOptions.where
        ? createFilterFunctionFromExpression(demand.requestOptions.where)
        : undefined,
    )
    const replacement = this.createPublicationDiff(
      session.publicationState.publishedRows,
      merged,
      (value) => activeDemandFilters.some((filter) => filter?.(value) ?? true),
    )
    if (replacement.length > 0) this.filteredCallback(replacement)
    // Buffering records every source key before active-demand filtering. Reset
    // the dedupe set to what the subscriber actually received so a later
    // request can publish a row that belonged only to a released demand.
    this.sentKeys = new Set(this.publishedRows.keys())
    if (this.orderByIndex) {
      this.limitedSnapshotRowCount = this.sentKeys.size
      const orderedSentKeys = this.orderByIndex.takeFromStart(
        this.sentKeys.size,
        (key) => this.sentKeys.has(key),
      )
      this.lastSentKey = orderedSentKeys.at(-1)
    }
  }

  /** Reduce a replay's raw delete/insert stream to one exact semantic delta. */
  private createPublicationDiff(
    baseline: ReadonlyMap<string | number, object>,
    changes: ReadonlyArray<ChangeMessage<any, any>>,
    isCoveredByActiveDemand: (value: object) => boolean,
  ): Array<ChangeMessage<any, any>> {
    const finalRows = new Map(baseline)
    for (const change of changes) {
      if (change.type === `delete`) finalRows.delete(change.key)
      else finalRows.set(change.key, change.value)
    }
    for (const [key, value] of finalRows) {
      if (!isCoveredByActiveDemand(value)) finalRows.delete(key)
    }

    const replacement: Array<ChangeMessage<any, any>> = []
    for (const [key, previousValue] of baseline) {
      const value = finalRows.get(key)
      if (value === undefined) {
        replacement.push({
          type: `delete`,
          key,
          value: previousValue,
        })
      } else if (!deepEquals(value, previousValue)) {
        replacement.push({
          type: `update`,
          key,
          value,
          previousValue,
        })
      }
    }
    for (const [key, value] of finalRows) {
      if (!baseline.has(key)) replacement.push({ type: `insert`, key, value })
    }
    return replacement
  }

  private get isBufferingForTruncate(): boolean {
    return this.truncateReplaySession !== undefined
  }

  setOrderByIndex(index: IndexInterface<any>) {
    this.orderByIndex = index
  }

  /**
   * Check if an orderBy index has been set for this subscription
   */
  hasOrderByIndex(): boolean {
    return this.orderByIndex !== undefined
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

  /** Observe an asynchronous subset load and restore status on settlement. */
  private observeLoadSubsetResult(
    syncResult: LoadSubsetRequestResult,
    options: LoadSubsetOptions,
    trackStatus: boolean,
    shouldReportError: () => boolean = () => true,
  ) {
    if (!(syncResult instanceof Promise)) return

    if (trackStatus) {
      this.pendingLoadSubsetPromises.add(syncResult)
      this.setStatus(`loadingSubset`)
    }

    const finish = () => {
      if (trackStatus) {
        this.pendingLoadSubsetPromises.delete(syncResult)
        if (this.pendingLoadSubsetPromises.size === 0) {
          this.setStatus(`ready`)
        }
      }
    }

    void syncResult.then(finish, (error: unknown) => {
      if (shouldReportError()) this.recordLoadSubsetError(options, error)
      finish()
    })
  }

  private loadSubset(
    options: LoadSubsetOptions,
    shouldReportError: () => boolean = () => true,
  ): LoadSubsetRequestResult {
    try {
      return this.collection._sync.loadSubset(options)
    } catch (error) {
      if (shouldReportError()) this.recordLoadSubsetError(options, error)
      throw error
    }
  }

  /** Create a fresh, abortable adapter acquisition for a replay generation. */
  private createSubsetAcquisition(
    demand: SubsetDemand,
  ): SubsetAcquisition & { abortController: AbortController } {
    const abortController = new AbortController()
    const requestSignal = demand.requestOptions.signal
    let removeRequestAbortListener: (() => void) | undefined

    if (requestSignal?.aborted) {
      abortController.abort(requestSignal.reason)
    } else if (requestSignal) {
      const abort = () => abortController.abort(requestSignal.reason)
      requestSignal.addEventListener(`abort`, abort, { once: true })
      removeRequestAbortListener = () =>
        requestSignal.removeEventListener(`abort`, abort)
    }

    return {
      options: {
        ...demand.requestOptions,
        signal: abortController.signal,
      },
      abortController,
      removeRequestAbortListener,
    }
  }

  /** Replace the adapter lease held for one logical subset demand. */
  private replaceSubsetAcquisition(
    demand: SubsetDemand,
    next: SubsetAcquisition & { abortController: AbortController },
  ): void {
    const previousOptions = demand.options
    const removePreviousAbortListener = demand.removeRequestAbortListener
    this.collection._sync.unloadSubset(previousOptions)
    removePreviousAbortListener?.()
    demand.options = next.options
    demand.abortController = next.abortController
    demand.removeRequestAbortListener = next.removeRequestAbortListener
  }

  /** Abort and release one current adapter acquisition. */
  private releaseSubsetDemand(demand: SubsetDemand): void {
    demand.abortController?.abort()
    try {
      this.collection._sync.unloadSubset(demand.options)
      demand.releaseFailed = false
    } catch (error) {
      demand.releaseFailed = true
      throw error
    } finally {
      demand.removeRequestAbortListener?.()
    }
  }

  /** Start and retain the first acquisition for one logical subset demand. */
  private startSubsetDemand(requestOptions: LoadSubsetOptions): {
    demand: SubsetDemand
    result: LoadSubsetRequestResult
  } {
    const demand: SubsetDemand = {
      requestOptions,
      options: requestOptions,
      releaseFailed: false,
    }
    const acquisition = this.createSubsetAcquisition(demand)
    demand.options = acquisition.options
    demand.abortController = acquisition.abortController
    demand.removeRequestAbortListener = acquisition.removeRequestAbortListener
    // Reentrant release must see the exact acquisition before adapter work
    // starts. A genuine load throw removes this tentative logical owner below.
    this.subsetDemands.push(demand)
    try {
      const result = this.loadSubset(acquisition.options)
      return { demand, result }
    } catch (error) {
      const demandIndex = this.subsetDemands.indexOf(demand)
      if (demandIndex !== -1 && !demand.releaseFailed) {
        this.subsetDemands.splice(demandIndex, 1)
        acquisition.abortController.abort()
        acquisition.removeRequestAbortListener?.()
      }
      throw error
    }
  }

  private recordLoadSubsetError(
    options: LoadSubsetOptions,
    error: unknown,
    reportAborted = false,
  ): void {
    // Aborted subset requests are obsolete demand, not load failures. The
    // request may reject after its route has already been released.
    if (options.signal?.aborted && !reportAborted) return

    this._lastError = error
    this.emitInner(`loadSubset:error`, {
      type: `loadSubset:error`,
      subscription: this,
      options,
      error,
    })
  }

  hasLoadedInitialState() {
    return this.loadedInitialState
  }

  hasSentAtLeastOneSnapshot() {
    return this.snapshotSent
  }

  emitEvents(changes: Array<ChangeMessage<any, any>>): boolean {
    const newChanges = this.filterAndFlipChanges(changes)

    // Reconciliation can reduce a source delta to no visible change. Do not
    // wake subscribers for an empty semantic batch.
    if (changes.length > 0 && newChanges.length === 0) return false

    if (this.isBufferingForTruncate) {
      // Buffer the changes instead of emitting immediately
      // This prevents a flash of missing content during truncate/refetch
      if (newChanges.length > 0) {
        this.truncateReplaySession!.buffer.push(newChanges)
      }
      return false
    } else {
      return this.filteredCallback(newChanges)
    }
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
    const loadOptions: LoadSubsetOptions = {
      where: stateOpts.where,
      signal: opts?.signal,
      subscription: this,
      // Include orderBy and limit if provided so sync layer can optimize the query
      orderBy: opts?.orderBy,
      limit: opts?.limit,
    }

    const { demand, result: syncResult } = this.startSubsetDemand(loadOptions)
    if (opts?.where) this.requestedSubsetWhere.set(loadOptions, opts.where)

    // Pass the raw loadSubset result to the caller for external tracking
    opts?.onLoadSubsetResult?.(syncResult)

    this.observeLoadSubsetResult(
      syncResult,
      demand.options,
      opts?.trackLoadSubsetPromise ?? true,
    )

    // Also load data immediately from the collection
    let snapshot: Array<ChangeMessage<any, any>> | void
    if (opts?.onUnoptimized) {
      snapshot = this.collection.currentStateAsChanges({
        ...stateOpts,
        optimizedOnly: true,
      })
      if (snapshot === undefined) {
        opts.onUnoptimized()
        snapshot = this.collection.currentStateAsChanges({
          ...stateOpts,
          optimizedOnly: false,
        })
      }
    } else {
      snapshot = this.collection.currentStateAsChanges(stateOpts)
    }

    if (snapshot === undefined) {
      // Couldn't load from indexes
      return false
    }

    // Only send changes that have not been sent yet
    const filteredSnapshot = snapshot.filter(
      (change) => !this.sentKeys.has(change.key),
    )

    // Add keys to sentKeys BEFORE calling callback to prevent race condition.
    // If a change event arrives while the callback is executing, it will see
    // the keys already in sentKeys and filter out duplicates correctly.
    for (const change of filteredSnapshot) {
      this.sentKeys.add(change.key)
    }

    this.snapshotSent = true
    this.callback(filteredSnapshot)
    return true
  }

  /** Release one exact subset request while keeping the subscription alive. */
  releaseSnapshot(where: BasicExpression<boolean>): void {
    const index = this.subsetDemands.findIndex(
      (demand) =>
        demand.requestOptions.where === where ||
        this.requestedSubsetWhere.get(demand.requestOptions) === where,
    )
    if (index === -1) return

    const demand = this.subsetDemands[index]
    if (!demand) return
    this.releaseSubsetDemand(demand)
    this.subsetDemands.splice(index, 1)
  }

  /**
   * Sends a snapshot that fulfills the `where` clause and all rows are bigger or equal to the cursor.
   * Requires a range index to be set with `setOrderByIndex` prior to calling this method.
   * It uses that range index to load the items in the order of the index.
   *
   * For multi-column orderBy:
   * - Uses first value from `minValues` for LOCAL index operations (wide bounds, ensures no missed rows)
   * - Uses all `minValues` to build a precise composite cursor for SYNC layer loadSubset
   *
   * Note 1: it may load more rows than the provided LIMIT because it loads all values equal to the first cursor value + limit values greater.
   *         This is needed to ensure that it does not accidentally skip duplicate values when the limit falls in the middle of some duplicated values.
   * Note 2: it does not send keys that have already been sent before.
   */
  requestLimitedSnapshot({
    orderBy,
    limit,
    minValues,
    offset,
    trackLoadSubsetPromise: shouldTrackLoadSubsetPromise = true,
    onLoadSubsetResult,
  }: RequestLimitedSnapshotOptions) {
    if (!limit) throw new Error(`limit is required`)

    if (!this.orderByIndex) {
      throw new Error(
        `Ordered snapshot was requested but no index was found. You have to call setOrderByIndex before requesting an ordered snapshot.`,
      )
    }

    // Check if minValues has a first element (regardless of its value)
    // This distinguishes between "no min value provided" vs "min value is undefined"
    const hasMinValue = minValues !== undefined && minValues.length > 0
    // Derive first column value from minValues (used for local index operations)
    const minValue = minValues?.[0]
    // Cast for index operations (index expects string | number)
    const minValueForIndex = minValue as string | number | undefined

    const index = this.orderByIndex
    const where = this.options.whereExpression
    const whereFilterFn = where
      ? createFilterFunctionFromExpression(where)
      : undefined

    const filterFn = (key: string | number | undefined): boolean => {
      if (key !== undefined && this.sentKeys.has(key)) {
        return false
      }

      const value = this.collection.get(key)
      if (value === undefined) {
        return false
      }

      return whereFilterFn?.(value) ?? true
    }

    let biggestObservedValue = minValueForIndex
    const changes: Array<ChangeMessage<any, string | number>> = []

    // If we have a minValue we need to handle the case
    // where there might be duplicate values equal to minValue that we need to include
    // because we can have data like this: [1, 2, 3, 3, 3, 4, 5]
    // so if minValue is 3 then the previous snapshot may not have included all 3s
    // e.g. if it was offset 0 and limit 3 it would only have loaded the first 3
    //      so we load all rows equal to minValue first, to be sure we don't skip any duplicate values
    //
    // For multi-column orderBy, we use the first column value for index operations (wide bounds)
    // This may load some duplicates but ensures we never miss any rows.
    let keys: Array<string | number> = []
    if (hasMinValue) {
      // First, get all items with the same FIRST COLUMN value as minValue
      // This provides wide bounds for the local index
      const { expression } = orderBy[0]!
      const allRowsWithMinValue = this.collection.currentStateAsChanges({
        where: eq(expression, new Value(minValueForIndex)),
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
          minValueForIndex!,
          filterFn,
        )
        keys.push(...keysGreaterThanMin)
      } else {
        keys = index.take(limit, minValueForIndex!, filterFn)
      }
    } else {
      // No min value provided, start from the beginning
      keys = index.takeFromStart(limit, filterFn)
    }

    const valuesNeeded = () => Math.max(limit - changes.length, 0)
    const collectionExhausted = () => keys.length === 0

    // Create a value extractor for the orderBy field to properly track the biggest indexed value
    const orderByExpression = orderBy[0]!.expression
    const valueExtractor =
      orderByExpression.type === `ref`
        ? compileExpression(new PropRef(orderByExpression.path), true)
        : null

    while (valuesNeeded() > 0 && !collectionExhausted()) {
      const insertedKeys = new Set<string | number>() // Track keys we add to `changes` in this iteration

      for (const key of keys) {
        const value = this.collection.get(key)!
        changes.push({
          type: `insert`,
          key,
          value,
        })
        // Extract the indexed value (e.g., salary) from the row, not the full row
        // This is needed for index.take() to work correctly with the BTree comparator
        biggestObservedValue = valueExtractor ? valueExtractor(value) : value
        insertedKeys.add(key) // Track this key
      }

      keys = index.take(valuesNeeded(), biggestObservedValue!, filterFn)
    }

    // Track row count for offset-based pagination (before sending to callback)
    // Use the current count as the offset for this load
    const currentOffset = this.limitedSnapshotRowCount

    // Add keys to sentKeys BEFORE calling callback to prevent race condition.
    // If a change event arrives while the callback is executing, it will see
    // the keys already in sentKeys and filter out duplicates correctly.
    for (const change of changes) {
      this.sentKeys.add(change.key)
    }

    this.callback(changes)

    // Update the row count and last key after sending (for next call's offset/cursor)
    this.limitedSnapshotRowCount = Math.max(
      this.limitedSnapshotRowCount,
      currentOffset + changes.length,
    )
    if (changes.length > 0) {
      this.lastSentKey = changes[changes.length - 1]!.key
    }

    // Build cursor expressions for sync layer loadSubset
    // The cursor expressions are separate from the main where clause
    // so the sync layer can choose cursor-based or offset-based pagination
    let cursorExpressions:
      | {
          whereFrom: BasicExpression<boolean>
          whereCurrent: BasicExpression<boolean>
          lastKey?: string | number
        }
      | undefined

    if (minValues !== undefined && minValues.length > 0) {
      const whereFromCursor = buildCursor(orderBy, minValues)

      if (whereFromCursor) {
        const { expression } = orderBy[0]!
        const cursorMinValue = minValues[0]

        // Build the whereCurrent expression for the first orderBy column
        // For Date values, we need to handle precision differences between JS (ms) and backends (μs)
        // A JS Date represents a 1ms range, so we query for all values within that range
        let whereCurrentCursor: BasicExpression<boolean>
        if (cursorMinValue instanceof Date) {
          const cursorMinValuePlus1ms = new Date(cursorMinValue.getTime() + 1)
          whereCurrentCursor = and(
            gte(expression, new Value(cursorMinValue)),
            lt(expression, new Value(cursorMinValuePlus1ms)),
          )
        } else {
          whereCurrentCursor = eq(expression, new Value(cursorMinValue))
        }

        cursorExpressions = {
          whereFrom: whereFromCursor,
          whereCurrent: whereCurrentCursor,
          lastKey: this.lastSentKey,
        }
      }
    }

    // Request the sync layer to load more data
    // don't await it, we will load the data into the collection when it comes in
    // Note: `where` does NOT include cursor expressions - they are passed separately
    // The sync layer can choose to use cursor-based or offset-based pagination
    const loadOptions: LoadSubsetOptions = {
      where, // Main filter only, no cursor
      limit,
      orderBy,
      cursor: cursorExpressions, // Cursor expressions passed separately
      offset: offset ?? currentOffset, // Use provided offset, or auto-tracked offset
      subscription: this,
    }

    const { demand, result: syncResult } = this.startSubsetDemand(loadOptions)

    // Pass the raw loadSubset result to the caller for external tracking
    onLoadSubsetResult?.(syncResult)
    this.observeLoadSubsetResult(
      syncResult,
      demand.options,
      shouldTrackLoadSubsetPromise,
    )
  }

  // TODO: also add similar test but that checks that it can also load it from the collection's loadSubset function
  //       and that that also works properly (i.e. does not skip duplicate values)

  /**
   * Filters and flips changes for keys that have not been sent yet.
   * Deletes are filtered out for keys that have not been sent yet.
   * Updates are flipped into inserts for keys that have not been sent yet.
   * Duplicate inserts are filtered out to prevent D2 multiplicity > 1.
   */
  private filterAndFlipChanges(changes: Array<ChangeMessage<any, any>>) {
    changes = this.reconcileStalePublishedChanges(changes)

    if (this.loadedInitialState || this.skipFiltering) {
      // We loaded the entire initial state or filtering is explicitly skipped
      // so no need to filter or flip changes
      return changes
    }

    // When buffering for truncate, we need all changes (including deletes) to pass through.
    // This is important because:
    // 1. If loadedInitialState was previously true, sentKeys will be empty
    //    (trackSentKeys early-returns when loadedInitialState is true)
    // 2. The truncate deletes are for keys that WERE sent to the subscriber
    // 3. We're collecting all changes atomically, so filtering doesn't make sense
    const skipDeleteFilter = this.isBufferingForTruncate

    const newChanges = []
    for (const change of changes) {
      let newChange = change
      const keyInSentKeys = this.sentKeys.has(change.key)

      if (!keyInSentKeys) {
        if (change.type === `update`) {
          newChange = { ...change, type: `insert`, previousValue: undefined }
          this.sentKeys.add(change.key)
        } else if (change.type === `delete`) {
          // Filter out deletes for keys that have not been sent,
          // UNLESS we're buffering for truncate (where all deletes should pass through)
          if (!skipDeleteFilter) {
            continue
          }
        } else {
          this.sentKeys.add(change.key)
        }
      } else {
        // Key was already sent - handle based on change type
        if (change.type === `insert`) {
          // Filter out duplicate inserts - the key was already inserted.
          // This prevents D2 multiplicity from going above 1, which would
          // cause deletes to not properly remove items (multiplicity would
          // go from 2 to 1 instead of 1 to 0).
          continue
        } else if (change.type === `delete`) {
          // Remove from sentKeys so future inserts for this key are allowed
          // (e.g., after truncate + reinsert)
          this.sentKeys.delete(change.key)
        }
      }
      newChanges.push(newChange)
    }
    return newChanges
  }

  /**
   * After a failed replay, the source collection is empty but subscribers still
   * hold the last good publication. Reconcile the first later source delta for
   * each retained key against that publication instead of treating it as a
   * duplicate insert.
   */
  private reconcileStalePublishedChanges(
    changes: Array<ChangeMessage<any, any>>,
  ): Array<ChangeMessage<any, any>> {
    if (this.stalePublishedRows.size === 0) return changes

    const reconciled: Array<ChangeMessage<any, any>> = []
    for (const change of changes) {
      const previous = this.stalePublishedRows.get(change.key)
      if (previous === undefined) {
        reconciled.push(change)
        continue
      }

      this.stalePublishedRows.delete(change.key)
      if (change.type === `delete`) {
        reconciled.push({
          ...change,
          value: previous,
          previousValue: undefined,
        })
      } else if (!deepEquals(previous, change.value)) {
        reconciled.push({
          ...change,
          type: `update`,
          previousValue: previous,
        })
      }
    }
    return reconciled
  }

  private trackPublishedRows(
    changes: Array<ChangeMessage<any, string | number>>,
  ): void {
    for (const change of changes) {
      if (change.type === `delete`) {
        this.publishedRows.delete(change.key)
      } else {
        this.publishedRows.set(change.key, change.value)
      }
    }
  }

  private trackSentKeys(changes: Array<ChangeMessage<any, string | number>>) {
    if (this.loadedInitialState || this.skipFiltering) {
      // No need to track sent keys if we loaded the entire state or filtering is skipped.
      // Since filtering won't be applied, all keys are effectively "observed".
      return
    }

    for (const change of changes) {
      if (change.type === `delete`) {
        this.sentKeys.delete(change.key)
      } else {
        this.sentKeys.add(change.key)
      }
    }

    // Keep the limited snapshot offset in sync with keys we've actually sent.
    // This matters when loadSubset resolves asynchronously and requestLimitedSnapshot
    // didn't have local rows to count yet.
    if (this.orderByIndex) {
      this.limitedSnapshotRowCount = Math.max(
        this.limitedSnapshotRowCount,
        this.sentKeys.size,
      )
    }
  }

  /**
   * Mark that the subscription should not filter any changes.
   * This is used when includeInitialState is explicitly set to false,
   * meaning the caller doesn't want initial state but does want ALL future changes.
   */
  markAllStateAsSeen() {
    this.skipFiltering = true
  }

  unsubscribe() {
    let firstCleanupError: unknown

    // Clean up truncate event listener
    try {
      this.truncateCleanup?.()
    } catch (error) {
      firstCleanupError = error
    }
    this.truncateCleanup = undefined

    // Stop any buffered replay from publishing after unsubscription.
    this.truncateReplaySession = undefined
    this.stalePublishedRows.clear()

    // Release the current adapter acquisition for each logical subset demand.
    const failedDemands: Array<SubsetDemand> = []
    for (const demand of this.subsetDemands) {
      try {
        this.releaseSubsetDemand(demand)
      } catch (error) {
        firstCleanupError ??= error
        failedDemands.push(demand)
      }
    }
    this.subsetDemands = failedDemands

    try {
      this.emitInner(`unsubscribed`, {
        type: `unsubscribed`,
        subscription: this,
      })
    } catch (error) {
      firstCleanupError ??= error
    } finally {
      // Clear all event listeners to prevent memory leaks
      this.clearListeners()
    }

    if (firstCleanupError !== undefined) throw firstCleanupError
  }
}
