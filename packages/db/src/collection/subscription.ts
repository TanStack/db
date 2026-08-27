import { ensureIndexForExpression } from '../indexes/auto-index.js'
import { and, gte, lt } from '../query/builder/functions.js'
import { Value } from '../query/ir.js'
import { EventEmitter } from '../event-emitter.js'
import {
  buildCursor,
  buildCursorEquality,
  canExpressCursorOrder,
} from '../utils/cursor.js'
import { deepEquals } from '../utils.js'
import { WindowState } from '../query/live/window-state.js'
import {
  createFilterFunctionFromExpression,
  createFilteredCallback,
} from './change-events.js'
import type { BasicExpression, OrderBy } from '../query/ir.js'
import type { TotalOrderBoundary } from '../query/total-order.js'
import type { IndexInterface } from '../indexes/base-index.js'
import type {
  AppliedLoadSubsetOutcome,
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
  onLoadSubsetResult?: (
    result: LoadSubsetRequestResult,
    demand: LoadSubsetOptions,
  ) => void
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
  onLoadSubsetResult?: (
    result: LoadSubsetRequestResult,
    demand: LoadSubsetOptions,
  ) => void
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
  orderedBoundary: TotalOrderBoundary | undefined
}

type SubsetAcquisition = {
  options: LoadSubsetOptions
  abortController?: AbortController
  removeRequestAbortListener?: () => void
}

type ReplaySubsetAcquisition = SubsetAcquisition & {
  abortController: AbortController
}

type SubsetDemand = SubsetAcquisition & {
  requestOptions: LoadSubsetOptions
  ordered?: {
    requestedPrefix: number
    hadBoundary: boolean
    requiresUnboundedRefinement: boolean
    revision: number
  }
  pendingReplayAcquisitions: Set<ReplaySubsetAcquisition>
  releaseFailed: boolean
  releaseSettled: boolean
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
  private lastCompleteOrderedBoundary: TotalOrderBoundary | undefined
  private staleOrderedBoundary: TotalOrderBoundary | undefined

  // Track the count of rows sent via requestLimitedSnapshot for offset-based pagination
  private limitedSnapshotRowCount = 0

  // Track the last key sent via requestLimitedSnapshot for cursor-based pagination
  private lastSentKey: string | number | undefined

  private filteredCallback: (changes: Array<ChangeMessage<any, any>>) => boolean

  private orderByIndex: IndexInterface<string | number> | undefined
  private orderedWindow: WindowState | undefined

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
      this.refreshLastCompleteOrderedBoundary()
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
      this.lastCompleteOrderedBoundary = undefined
      this.staleOrderedBoundary = undefined
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
          orderedBoundary: this.lastCompleteOrderedBoundary,
        },
        buffer: [],
        attempts: new Set(),
        currentAttempt: attempt,
      }
      this.truncateReplaySession = session
    }
    session.attempts.add(attempt)
    session.currentAttempt = attempt

    // Truncate starts a new source generation. Its rows cannot inherit an
    // ordered boundary or admission proof from the generation being replaced.
    this.orderedWindow?.resetCoverage()

    // A newer replay replaces every prior acquisition for these demands. Abort
    // the old work before it can install rows into the new generation.
    for (const demand of demandsToReload) {
      demand.abortController?.abort()
      for (const pending of demand.pendingReplayAcquisitions) {
        pending.abortController.abort()
      }
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
        if (demand.ordered && this.orderedWindow) {
          demand.ordered.revision = this.orderedWindow.coverageRevision
        }
        const nextAcquisition = this.createSubsetAcquisition(demand)
        demand.pendingReplayAcquisitions.add(nextAcquisition)
        let syncResult: LoadSubsetRequestResult
        try {
          syncResult = this.loadSubset(
            nextAcquisition.options,
            isCurrentAttempt,
          )
        } catch {
          demand.pendingReplayAcquisitions.delete(nextAcquisition)
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

        let ownsReplacement = false
        if (syncResult instanceof Promise) {
          // Install the replacement lease before ordered coverage observes the
          // same settlement. Replay publication is tracked last so a fallback
          // request can join this atomic attempt before it completes.
          void syncResult.then(
            () => {
              ownsReplacement = this.completeReplayAcquisition(
                session,
                attempt,
                demand,
                nextAcquisition,
              )
            },
            () => {
              const failedCurrentDemand =
                this.subsetDemands.includes(demand) &&
                !nextAcquisition.options.signal?.aborted
              // A released demand no longer participates in the current
              // replacement. Its cooperative AbortError must not discard the
              // successful rows from demands that are still active.
              if (failedCurrentDemand) {
                attempt.failed = true
              }
              this.discardReplayAcquisition(demand, nextAcquisition)
            },
          )
        } else {
          ownsReplacement = this.completeReplayAcquisition(
            session,
            attempt,
            demand,
            nextAcquisition,
          )
        }

        if (demand.ordered !== undefined) {
          // The replacement acquisition, not the retired generation, owns any
          // row provenance published by this replay result.
          this.observeOrderedCoverage(syncResult, demand, () => ownsReplacement)
        }

        // Register this after ordered coverage so replay publication cannot
        // overtake its boundary evidence on the same promise.
        this.trackTruncateReplayResult(session, attempt, syncResult, () => {
          // A released demand no longer participates in the current
          // replacement. Its cooperative AbortError must not discard the
          // successful rows from demands that are still active.
          return (
            this.subsetDemands.includes(demand) &&
            !nextAcquisition.options.signal?.aborted
          )
        })
      }

      attempt.setupComplete = true
      this.checkTruncateReplayComplete(session)
    })
  }

  private trackTruncateReplayResult(
    session: TruncateReplaySession,
    attempt: TruncateReplayAttempt,
    result: LoadSubsetRequestResult,
    shouldFailAttempt: () => boolean,
  ): void {
    if (!(result instanceof Promise)) return

    // A transport promise may be shared by several deduplicated logical
    // demands. Track each demand separately so one settlement observer cannot
    // complete the attempt before the others apply their result.
    const pending = { promise: result }
    attempt.pending.add(pending)
    void result.then(
      () => this.settleTruncateReplay(session, attempt, pending),
      () => {
        if (shouldFailAttempt()) attempt.failed = true
        this.settleTruncateReplay(session, attempt, pending)
      },
    )
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
    this.lastCompleteOrderedBoundary = publicationState.orderedBoundary
    this.staleOrderedBoundary = publicationState.orderedBoundary
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
    this.staleOrderedBoundary = undefined

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
      if (this.orderedWindow) {
        this.limitedSnapshotRowCount = this.orderedWindow.localPrefixSize
        this.lastSentKey = this.orderedBoundary()?.key
      } else {
        this.limitedSnapshotRowCount = this.sentKeys.size
        const orderedSentKeys = this.orderByIndex.takeFromStart(
          this.sentKeys.size,
          (key) => this.sentKeys.has(key),
        )
        this.lastSentKey = orderedSentKeys.at(-1)
      }
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

  /** Retain enough locally known rows to cover this ordered window prefix. */
  ensureOrderedWindowSize(size: number): boolean {
    if (!this.orderedWindow) return false
    this.orderedWindow.ensureSize(size)
    if (this.stalePublishedRows.size > 0) return false
    const changes = this.reconcileOrderedWindow()
    if (changes.length === 0) return false
    this.callback(changes)
    return true
  }

  get orderedRowsNeeded(): number {
    return this.orderedWindow?.rowsNeeded() ?? 0
  }

  get hasOrderedCoverageForActiveWindow(): boolean {
    return this.orderedWindow?.coversActiveWindow ?? false
  }

  get orderedBoundaryRow(): object | undefined {
    const boundary =
      this.stalePublishedRows.size > 0
        ? this.orderedBoundary()
        : this.orderedWindow?.requestBoundary()
    return boundary === undefined
      ? undefined
      : (this.publishedRows.get(boundary.key) ??
          this.collection.get(boundary.key))
  }

  private orderedBoundary() {
    return this.stalePublishedRows.size > 0
      ? this.staleOrderedBoundary
      : this.orderedWindow?.boundary()
  }

  private reconcileOrderedWindow(): Array<ChangeMessage<any, any>> {
    if (!this.orderedWindow) return []
    const additionalFilters = this.subsetDemands
      .filter((demand) => demand.ordered === undefined)
      .map((demand) =>
        demand.requestOptions.where
          ? createFilterFunctionFromExpression(demand.requestOptions.where)
          : undefined,
      )
    const changes = this.orderedWindow.reconcile(
      this.publishedRows,
      additionalFilters.length === 0
        ? undefined
        : (row) => additionalFilters.some((filter) => filter?.(row) ?? true),
    )
    this.refreshLastCompleteOrderedBoundary()
    return changes
  }

  /** Retain the exact ordered prefix boundary while its source rows exist. */
  private refreshLastCompleteOrderedBoundary(): void {
    if (
      !this.orderedWindow ||
      this.isBufferingForTruncate ||
      this.stalePublishedRows.size > 0
    ) {
      return
    }
    this.lastCompleteOrderedBoundary = this.orderedWindow.boundary()
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
    demand.releaseFailed = false
    demand.releaseSettled = false
  }

  /** Attach a successful replay only while every owning authority is current. */
  private completeReplayAcquisition(
    session: TruncateReplaySession,
    attempt: TruncateReplayAttempt,
    demand: SubsetDemand,
    next: ReplaySubsetAcquisition,
  ): boolean {
    const mayReplace =
      this.truncateReplaySession === session &&
      session.currentAttempt === attempt &&
      this.subsetDemands.includes(demand) &&
      demand.pendingReplayAcquisitions.has(next) &&
      !demand.releaseSettled &&
      !next.options.signal?.aborted

    if (mayReplace) {
      return this.tryReplaceSubsetAcquisition(demand, next, attempt)
    }
    this.discardReplayAcquisition(demand, next)
    return false
  }

  private tryReplaceSubsetAcquisition(
    demand: SubsetDemand,
    next: ReplaySubsetAcquisition,
    attempt: TruncateReplayAttempt,
  ): boolean {
    try {
      this.replaceSubsetAcquisition(demand, next)
      demand.pendingReplayAcquisitions.delete(next)
      return true
    } catch (error) {
      // The old lease remains owned when its release fails. Release the new
      // acquisition and keep the old one available for a cleanup retry.
      this.discardReplayAcquisition(demand, next)
      this.recordLoadSubsetError(demand.options, error, true)
      attempt.failed = true
      return false
    }
  }

  private discardReplayAcquisition(
    demand: SubsetDemand,
    next: ReplaySubsetAcquisition,
  ): void {
    try {
      this.releaseReplayAcquisition(demand, next)
    } catch {
      // Keep the failed acquisition on the demand. releaseSnapshot,
      // unsubscribe, or collection cleanup will retry its exact owner route.
    }
  }

  private releaseReplayAcquisition(
    demand: SubsetDemand,
    next: ReplaySubsetAcquisition,
  ): void {
    if (!demand.pendingReplayAcquisitions.has(next)) return
    next.abortController.abort()
    try {
      this.collection._sync.unloadSubset(next.options)
      demand.pendingReplayAcquisitions.delete(next)
    } finally {
      next.removeRequestAbortListener?.()
    }
  }

  /** Abort and release one current adapter acquisition. */
  private releaseSubsetDemand(demand: SubsetDemand): void {
    demand.abortController?.abort()
    let firstReleaseError: unknown
    for (const pending of [...demand.pendingReplayAcquisitions]) {
      try {
        this.releaseReplayAcquisition(demand, pending)
      } catch (error) {
        firstReleaseError ??= error
      }
    }
    if (!demand.releaseSettled) {
      try {
        this.collection._sync.unloadSubset(demand.options)
        demand.releaseFailed = false
        demand.releaseSettled = true
      } catch (error) {
        demand.releaseFailed = true
        firstReleaseError ??= error
      } finally {
        demand.removeRequestAbortListener?.()
      }
    }
    if (firstReleaseError !== undefined) throw firstReleaseError
  }

  /** Start and retain the first acquisition for one logical subset demand. */
  private startSubsetDemand(
    requestOptions: LoadSubsetOptions,
    ordered?: SubsetDemand[`ordered`],
  ): {
    demand: SubsetDemand
    result: LoadSubsetRequestResult
  } {
    const demand: SubsetDemand = {
      requestOptions,
      options: requestOptions,
      ...(ordered === undefined ? {} : { ordered }),
      pendingReplayAcquisitions: new Set(),
      releaseFailed: false,
      releaseSettled: false,
    }
    const acquisition = this.createSubsetAcquisition(demand)
    demand.options = acquisition.options
    demand.abortController = acquisition.abortController
    demand.removeRequestAbortListener = acquisition.removeRequestAbortListener
    if (acquisition.abortController.signal.aborted) {
      acquisition.removeRequestAbortListener?.()
      return { demand, result: true }
    }
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
    if (
      this.orderedWindow &&
      !this.isBufferingForTruncate &&
      this.stalePublishedRows.size === 0
    ) {
      this.orderedWindow.admitChanges(changes)
      const orderedChanges = this.reconcileOrderedWindow()
      if (changes.length > 0 && orderedChanges.length === 0) return false
      this.callback(orderedChanges)
      return true
    }

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
    opts?.onLoadSubsetResult?.(syncResult, demand.options)

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
    if (
      this.orderedWindow &&
      !this.isBufferingForTruncate &&
      this.stalePublishedRows.size === 0
    ) {
      const changes = this.reconcileOrderedWindow()
      if (changes.length > 0) this.callback(changes)
    }
  }

  /**
   * Reconciles the exact locally known ordered prefix, then asks the sync layer
   * for enough rows after its total-order boundary to extend that prefix.
   */
  requestLimitedSnapshot({
    orderBy,
    limit,
    minValues,
    offset,
    trackLoadSubsetPromise: shouldTrackLoadSubsetPromise = true,
    onLoadSubsetResult,
  }: RequestLimitedSnapshotOptions) {
    if (!this.orderByIndex) {
      throw new Error(
        `Ordered snapshot was requested but no index was found. You have to call setOrderByIndex before requesting an ordered snapshot.`,
      )
    }

    this.orderedWindow ??= new WindowState(
      this.collection,
      orderBy,
      this.options.whereExpression,
      limit,
    )

    const where = this.options.whereExpression
    const refreshPrefix =
      this.stalePublishedRows.size === 0 &&
      this.orderedWindow.requiresPrefixRefresh
    // A failed truncate replay leaves the last complete publication visible
    // while the source collection is empty. Continue from that retained prefix
    // until a later replay replaces it.
    const currentOffset =
      this.stalePublishedRows.size > 0
        ? this.limitedSnapshotRowCount
        : refreshPrefix
          ? 0
          : this.orderedWindow.localPrefixSize
    const requestedPrefix = refreshPrefix
      ? Math.max(this.orderedWindow.size, limit)
      : offset !== undefined
        ? offset + limit
        : minValues !== undefined
          ? currentOffset + limit
          : limit
    this.orderedWindow.ensureSize(requestedPrefix)
    let requiresUnboundedRefinement = this.orderedWindow.requiresFullRefinement
    const changes =
      !this.isBufferingForTruncate && this.stalePublishedRows.size === 0
        ? this.reconcileOrderedWindow()
        : []

    if (changes.length > 0) this.callback(changes)

    // A zero window establishes no remote demand, but it must still create the
    // ordered coordinator so a later setWindow can load from the same order.
    if (limit === 0) {
      onLoadSubsetResult?.(true, {
        where,
        orderBy,
        limit: 0,
        subscription: this,
      })
      return
    }

    if (
      this.stalePublishedRows.size === 0 &&
      this.orderedWindow.coversActiveWindow
    ) {
      // No adapter request was made. Use an impossible zero-window demand so
      // direct tracking can finish without claiming another demand's outcome.
      onLoadSubsetResult?.(true, {
        where,
        orderBy,
        limit: 0,
        subscription: this,
      })
      return
    }

    // Keep legacy offset bookkeeping aligned with the exact retained prefix.
    this.limitedSnapshotRowCount = Math.max(
      this.limitedSnapshotRowCount,
      this.orderedWindow.localPrefixSize,
    )
    this.lastSentKey = this.orderedBoundary()?.key

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
    const boundary =
      this.stalePublishedRows.size > 0
        ? this.orderedBoundary()
        : this.orderedWindow.requestBoundary()
    const cursorValues = boundary?.values ?? minValues
    if (cursorValues !== undefined && cursorValues.length > 0) {
      const canPushCursor = canExpressCursorOrder(orderBy, cursorValues)
      if (!canPushCursor) requiresUnboundedRefinement = true
      const whereFromCursor = canPushCursor
        ? buildCursor(orderBy, [...cursorValues])
        : undefined

      if (whereFromCursor) {
        const { expression } = orderBy[0]!
        const cursorMinValue = cursorValues[0]

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
          whereCurrentCursor = buildCursorEquality(expression, cursorMinValue)
        }

        cursorExpressions = {
          whereFrom: whereFromCursor,
          whereCurrent: whereCurrentCursor,
          lastKey: boundary?.key ?? this.lastSentKey,
        }
      }
    }

    // Request the sync layer to load more data
    // don't await it, we will load the data into the collection when it comes in
    // Note: `where` does NOT include cursor expressions - they are passed separately
    // The sync layer can choose to use cursor-based or offset-based pagination
    const loadOptions: LoadSubsetOptions = requiresUnboundedRefinement
      ? {
          where,
          orderBy,
          subscription: this,
        }
      : refreshPrefix
        ? {
            where,
            limit: requestedPrefix,
            orderBy,
            offset: 0,
            subscription: this,
          }
        : {
            where, // Main filter only, no cursor
            limit,
            orderBy,
            cursor: cursorExpressions, // Cursor expressions passed separately
            offset: offset ?? currentOffset, // Use provided offset, or auto-tracked offset
            subscription: this,
          }

    const { demand, result: syncResult } = this.startSubsetDemand(loadOptions, {
      requestedPrefix,
      hadBoundary: boundary !== undefined || refreshPrefix,
      requiresUnboundedRefinement,
      revision: this.orderedWindow.coverageRevision,
    })

    this.observeOrderedCoverage(syncResult, demand)
    // Pass the raw loadSubset result to the caller for external tracking
    onLoadSubsetResult?.(syncResult, demand.options)
    this.observeLoadSubsetResult(
      syncResult,
      demand.options,
      shouldTrackLoadSubsetPromise,
    )
  }

  private observeOrderedCoverage(
    result: LoadSubsetRequestResult,
    demand: SubsetDemand,
    shouldApply: () => boolean = () => true,
  ): void {
    const ordered = demand.ordered
    const window = this.orderedWindow
    if (!ordered || !window) return

    const apply = (outcome?: AppliedLoadSubsetOutcome) => {
      if (
        !shouldApply() ||
        !this.subsetDemands.includes(demand) ||
        demand.options.signal?.aborted
      ) {
        return
      }

      // The settled outcome is the caller-relative acquisition evidence. Its
      // applied keys remain useful even when the source cannot prove an extent,
      // while such unknown evidence is intentionally absent from the reusable
      // coverage antichain. WindowState filters a shared covering acquisition's
      // physical keys through this subscription's predicate and total order.
      const rowKeys = outcome?.appliedRowKeys
      const exhausted = outcome?.extent === `exhausted`

      if (outcome !== undefined && rowKeys === undefined && !exhausted) {
        window.recordLocalRequestSatisfaction(ordered.requestedPrefix)
      } else if (!ordered.hadBoundary && !ordered.requiresUnboundedRefinement) {
        window.recordInitialCoverage(rowKeys, exhausted)
      } else {
        window.recordContinuationCoverage(
          rowKeys,
          exhausted,
          ordered.requestedPrefix,
          ordered.revision,
        )
      }

      if (this.isBufferingForTruncate || this.stalePublishedRows.size > 0) {
        return
      }
      const changes = this.reconcileOrderedWindow()
      if (changes.length > 0) this.callback(changes)
    }

    if (result instanceof Promise) {
      void result.then(apply, () => {})
    } else {
      const hasSubsetLoader = this.collection._sync.syncLoadSubsetFn !== null
      if (!hasSubsetLoader) {
        // Eager sources are already complete.
        window.recordContinuationCoverage(
          undefined,
          true,
          ordered.requestedPrefix,
          ordered.revision,
        )
      } else {
        const retainedOutcome = this.collection._sync.getLoadSubsetOutcome(
          demand.options,
        )
        if (retainedOutcome) {
          apply(retainedOutcome)
          return
        }
        window.recordLocalRequestSatisfaction(ordered.requestedPrefix)
      }
      if (!this.isBufferingForTruncate && this.stalePublishedRows.size === 0) {
        const changes = this.reconcileOrderedWindow()
        if (changes.length > 0) this.callback(changes)
      }
    }
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
    if (this.stalePublishedRows.size === 0) {
      this.lastCompleteOrderedBoundary = undefined
      this.staleOrderedBoundary = undefined
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
        this.orderedWindow?.localPrefixSize ?? this.sentKeys.size,
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
    this.lastCompleteOrderedBoundary = undefined
    this.staleOrderedBoundary = undefined

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
