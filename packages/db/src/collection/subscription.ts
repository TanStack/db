import { ensureIndexForExpression } from '../indexes/auto-index.js'
import { and, eq } from '../query/builder/functions.js'
import { PropRef, Value } from '../query/ir.js'
import { EventEmitter } from '../event-emitter.js'
import { compileExpression } from '../query/compiler/evaluators.js'
import { buildCursor, buildCursorCurrent } from '../utils/cursor.js'
import { deepEquals } from '../utils.js'
import { normalizeError } from '../utils/error.js'
import { runAllCallbacks } from '../utils/callbacks.js'
import { getLoadSubsetDemandKey } from '../query/ir-stable-identity.js'
import { createDeferred } from '../deferred.js'
import { LoadSubsetOperationAbortedError } from '../errors.js'
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
import type { Deferred } from '../deferred.js'

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
    options: LoadSubsetOptions,
    release?: ReleaseLoadSubset,
  ) => void
  /** Called when the local snapshot must fall back from an index to a scan. */
  onUnoptimized?: () => void
  /** Replace an earlier exact acquisition before retrying it. */
  replaceExistingDemand?: boolean
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
    options: LoadSubsetOptions,
    release?: ReleaseLoadSubset,
  ) => void
}

export type ReleaseLoadSubset = (
  primaryFailure?: { error: unknown },
) => void

type CollectionSubscriptionOptions = {
  includeInitialState?: boolean
  /** Pre-compiled expression for filtering changes */
  whereExpression?: BasicExpression<boolean>
  /** Callback to call when the subscription is unsubscribed */
  onUnsubscribe?: (event: SubscriptionUnsubscribedEvent) => void
  /** Callback for subset-load failures scoped to this subscription. */
  onLoadSubsetError?: (event: SubscriptionLoadSubsetErrorEvent) => void
  truncateReplayPublication?: TruncateReplayPublicationControl
}

type TruncateReplayPublicationControl = Readonly<{
  start: () => void
  succeed: () => void
}>

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
}

type TruncateReplayAttempt = {
  pending: Set<{ demand: SubsetDemand; promise: Promise<unknown> }>
  failedDemands: Set<SubsetDemand>
  setupComplete: boolean
}

type TruncateReplaySession = {
  publicationState: TruncatePublicationState
  privateRows: Map<string | number, object>
  attempts: Set<TruncateReplayAttempt>
  currentAttempt: TruncateReplayAttempt
  completion: Deferred<void>
}

function createReplayCompletion(): Deferred<void> {
  const completion = createDeferred<void>()
  void completion.promise.catch(() => {})
  return completion
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
  private releaseDebts: Array<SubsetAcquisition> = []
  private releasingAcquisitions = new Set<SubsetAcquisition>()
  private primaryFailureDeliveryDepth = 0
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
  private statusRevision = 0
  private _lastError: unknown | undefined
  private pendingLoadSubsetParticipants = new Set<{
    demand: SubsetDemand
    promise: Promise<unknown>
  }>()

  // Cleanup function for truncate event listener
  private truncateCleanup: (() => void) | undefined

  // One replay session owns the publication baseline, overlapping attempts,
  // and buffered changes until every attempt settles.
  private truncateReplaySession: TruncateReplaySession | undefined
  private readonly loadSubsetPromiseErrors = new WeakMap<
    Promise<unknown>,
    Error
  >()
  private truncateReplacementPending = false
  private unsubscribed = false

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
   * A failed replay keeps the last published snapshot private until a later
   * authoritative replay succeeds.
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
      failedDemands: new Set(),
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
        privateRows: new Map(this.publishedRows),
        attempts: new Set(),
        currentAttempt: attempt,
        completion: createReplayCompletion(),
      }
      this.truncateReplaySession = session
    } else if (!session.completion.isPending()) {
      session.completion = createReplayCompletion()
    }
    for (const previous of session.attempts) {
      if (previous.setupComplete && previous.pending.size === 0) {
        session.attempts.delete(previous)
      }
    }
    session.attempts.add(attempt)
    session.currentAttempt = attempt

    if (this.options.truncateReplayPublication) {
      this.truncateReplacementPending = true
      this.options.truncateReplayPublication.start()
    }

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
      if (session.currentAttempt !== attempt) {
        // A newer truncate arrived before this attempt began source work. It
        // already captured the active demands, so starting this obsolete
        // acquisition now would place it outside the newer abort sweep.
        attempt.setupComplete = true
        this.checkTruncateReplayComplete(session)
        return
      }

      for (const demand of demandsToReload) {
        if (!this.subsetDemands.includes(demand)) continue
        this.startTruncateReplayDemand(session, attempt, demand)
        if (
          this.truncateReplaySession !== session ||
          session.currentAttempt !== attempt
        ) {
          break
        }
      }

      attempt.setupComplete = true
      this.checkTruncateReplayComplete(session)
    })
  }

  /** Make tentative replay ownership visible before adapter code can reenter. */
  private startTruncateReplayDemand(
    session: TruncateReplaySession,
    attempt: TruncateReplayAttempt,
    demand: SubsetDemand,
  ): void {
    const previous: SubsetAcquisition = {
      options: demand.options,
      abortController: demand.abortController,
      removeRequestAbortListener: demand.removeRequestAbortListener,
    }
    const next = this.createSubsetAcquisition(demand)
    const restorePrevious = () => {
      if (demand.options !== next.options) return
      demand.options = previous.options
      demand.abortController = previous.abortController
      demand.removeRequestAbortListener = previous.removeRequestAbortListener
    }
    const isCurrentAttempt = () =>
      this.truncateReplaySession === session &&
      session.currentAttempt === attempt

    demand.options = next.options
    demand.abortController = next.abortController
    demand.removeRequestAbortListener = next.removeRequestAbortListener

    let result: LoadSubsetRequestResult
    try {
      result = this.loadSubset(
        next.options,
        () => isCurrentAttempt() && this.subsetDemands.includes(demand),
      )
    } catch {
      const demandRemains = this.subsetDemands.includes(demand)
      restorePrevious()
      if (demandRemains) {
        next.abortController.abort()
        next.removeRequestAbortListener?.()
      } else {
        try {
          this.releaseOrRetainAcquisition(previous)
        } catch {
          // The failed replay already owns the first error. Keep this old lease
          // as cleanup debt without replacing it.
        }
      }
      if (demandRemains && isCurrentAttempt()) {
        attempt.failedDemands.add(demand)
      }
      return
    }

    if (!this.subsetDemands.includes(demand)) {
      // Reentrant release already retired `next`; it could not see the old
      // acquisition held on this stack, so retire that exact lease now.
      try {
        this.releaseOrRetainAcquisition(previous)
      } catch {
        attempt.failedDemands.add(demand)
      }
      return
    }

    this.trackTruncateReplayParticipant(
      session,
      attempt,
      demand,
      next.options,
      result,
    )
    const statusParticipant = this.observeLoadSubsetResult(
      result,
      demand,
      next.options,
      true,
      () =>
        isCurrentAttempt() &&
        this.subsetDemands.includes(demand) &&
        !next.options.signal?.aborted,
    )
    if (!this.subsetDemands.includes(demand)) {
      // A status listener retired the tentative acquisition. It could not see
      // the old lease held on this stack, so retire that lease exactly once.
      try {
        this.releaseOrRetainAcquisition(previous)
      } catch {
        attempt.failedDemands.add(demand)
      }
      return
    }
    if (!isCurrentAttempt()) {
      // A reentrant truncate aborted this tentative acquisition before it was
      // returned. Keep its async work in the captured attempt's barrier, but
      // restore the demand's prior lease for the newer replay to replace.
      restorePrevious()
      next.abortController.abort()
      try {
        this.releaseOrRetainAcquisition(next)
      } catch {
        attempt.failedDemands.add(demand)
      }
      return
    }

    // Reuse the established replacement path after restoring the state it
    // expects. This unloads the old lease only after adapter startup succeeds.
    restorePrevious()
    try {
      this.replaceSubsetAcquisition(demand, next)
    } catch (error) {
      // The old lease is still owned because its release failed. Abort and
      // release the new acquisition, but keep observing its work so rows from
      // a non-cooperative adapter cannot escape the replay buffer.
      if (this.subsetDemands.includes(demand)) {
        next.abortController.abort()
        try {
          this.releaseOrRetainAcquisition(next)
        } catch {
          // Preserve the first ownership error. The demand still retains the
          // old acquisition so normal cleanup can retry that release.
        }
      }
      this.recordLoadSubsetError(demand.options, error, true)
      this.stopStatusParticipant(statusParticipant)
      attempt.failedDemands.add(demand)
    }
  }

  private settleTruncateReplay(
    session: TruncateReplaySession,
    attempt: TruncateReplayAttempt,
    pending: { demand: SubsetDemand; promise: Promise<unknown> },
  ): void {
    try {
      if (this.truncateReplaySession !== session) return
      attempt.pending.delete(pending)
      if (
        attempt !== session.currentAttempt &&
        attempt.setupComplete &&
        attempt.pending.size === 0
      ) {
        session.attempts.delete(attempt)
      }
      this.checkTruncateReplayComplete(session)
    } catch (error) {
      // Replay settlement runs from a Promise callback, so throwing here would
      // create an unobserved derived rejection. Surface subscriber errors like
      // other async collection events instead.
      queueMicrotask(() => {
        throw error
      })
    }
  }

  /** Keep every acquisition begun during recovery inside its publication barrier. */
  private trackTruncateReplayParticipant(
    session: TruncateReplaySession,
    attempt: TruncateReplayAttempt,
    demand: SubsetDemand,
    options: LoadSubsetOptions,
    result: LoadSubsetRequestResult,
  ): void {
    if (
      this.truncateReplaySession !== session ||
      !session.attempts.has(attempt) ||
      !(result instanceof Promise)
    ) {
      return
    }

    // A transport promise may be shared by several logical demands. Track each
    // acquisition separately so one observer cannot complete the attempt early.
    const pending = { demand, promise: result }
    attempt.pending.add(pending)
    void result.then(
      () => this.settleTruncateReplay(session, attempt, pending),
      (error: unknown) => {
        // A released demand no longer participates in this replacement. Its
        // cooperative AbortError must not discard rows from active demands.
        if (this.subsetDemands.includes(demand) && !options.signal?.aborted) {
          const normalized = this.normalizeLoadSubsetPromiseError(result, error)
          // Replay completion is observed before the ordinary status listener,
          // so retain the exact normalized error for the completion barrier.
          // The status listener emits the public error event next.
          this._lastError = normalized
          attempt.failedDemands.add(demand)
        }
        this.settleTruncateReplay(session, attempt, pending)
      },
    )
  }

  /** Stop obsolete logical demand from pinning a replay barrier. */
  private removeTruncateReplayParticipant(demand: SubsetDemand): void {
    const session = this.truncateReplaySession
    if (!session) return
    for (const attempt of session.attempts) {
      attempt.failedDemands.delete(demand)
      for (const pending of attempt.pending) {
        if (pending.demand === demand) attempt.pending.delete(pending)
      }
      if (
        attempt !== session.currentAttempt &&
        attempt.setupComplete &&
        attempt.pending.size === 0
      ) {
        session.attempts.delete(attempt)
      }
    }
  }

  /** Publish only after every overlapping replay attempt has settled. */
  private checkTruncateReplayComplete(session: TruncateReplaySession): void {
    if (this.truncateReplaySession !== session) return
    for (const attempt of session.attempts) {
      if (!attempt.setupComplete || attempt.pending.size > 0) return
    }

    const activeFailure = [...session.currentAttempt.failedDemands].some(
      (demand) => this.subsetDemands.includes(demand),
    )
    if (activeFailure) {
      this.abandonTruncateReplay(session)
    } else {
      this.flushTruncateReplay(session)
    }
  }

  /**
   * Keep an incomplete replay private. The source no longer proves a complete
   * state, so only a later successful truncate replay may reopen publication.
   */
  private abandonTruncateReplay(session: TruncateReplaySession): void {
    if (this.truncateReplaySession !== session) return
    if (this.options.truncateReplayPublication) {
      session.completion.reject(
        this._lastError ?? new Error(`Truncate replay failed`),
      )
      return
    }
    const publicationState = session.publicationState
    this.loadedInitialState = publicationState.loadedInitialState
    this.snapshotSent = publicationState.snapshotSent
    this.sentKeys = new Set(publicationState.sentKeys)
    this.publishedRows = new Map(publicationState.publishedRows)
    this.stalePublishedRows = new Map(publicationState.publishedRows)
    this.limitedSnapshotRowCount = publicationState.limitedSnapshotRowCount
    this.lastSentKey = publicationState.lastSentKey
    session.privateRows = new Map(publicationState.publishedRows)
  }

  /** Publish the complete buffered replacement as one subscriber batch. */
  private flushTruncateReplay(session: TruncateReplaySession): void {
    if (this.truncateReplaySession !== session) return
    this.truncateReplaySession = undefined

    if (this.options.truncateReplayPublication) {
      this.stalePublishedRows.clear()
      this.restorePublishedSnapshotTracking()
      this.truncateReplacementPending = false
      session.completion.resolve()
      this.options.truncateReplayPublication.succeed()
      return
    }

    const retainedDeletes = [...this.stalePublishedRows].map(
      ([key, value]): ChangeMessage<any, any> => ({
        type: `delete`,
        key,
        value,
      }),
    )
    this.stalePublishedRows.clear()

    this.applyPrivateChanges(session, retainedDeletes)
    const activeDemandFilters = this.subsetDemands.map((demand) =>
      demand.requestOptions.where
        ? createFilterFunctionFromExpression(demand.requestOptions.where)
        : undefined,
    )
    const finalRows = new Map(session.privateRows)
    for (const [key, value] of finalRows) {
      if (!activeDemandFilters.some((filter) => filter?.(value) ?? true)) {
        finalRows.delete(key)
      }
    }
    const replacement = this.createStateDiff(
      session.publicationState.publishedRows,
      finalRows,
    )
    try {
      if (replacement.length > 0) this.filteredCallback(replacement)
    } finally {
      // Buffering records every source key before active-demand filtering.
      // Restore tracking even when a subscriber rejects the replacement.
      this.restorePublishedSnapshotTracking()
      session.completion.resolve()
    }
  }

  private restorePublishedSnapshotTracking(): void {
    this.sentKeys = new Set(this.publishedRows.keys())
    if (!this.orderByIndex) return

    this.limitedSnapshotRowCount = this.sentKeys.size
    const orderedSentKeys = this.orderByIndex.takeFromStart(
      this.sentKeys.size,
      (key) => this.sentKeys.has(key),
    )
    this.lastSentKey = orderedSentKeys.at(-1)
  }

  /** Fold private replay changes into bounded state, not an event history. */
  private applyPrivateChanges(
    session: TruncateReplaySession,
    changes: ReadonlyArray<ChangeMessage<any, any>>,
  ): void {
    for (const change of changes) {
      if (change.type === `delete`) session.privateRows.delete(change.key)
      else session.privateRows.set(change.key, change.value)
    }
  }

  private createStateDiff(
    baseline: ReadonlyMap<string | number, object>,
    finalRows: ReadonlyMap<string | number, object>,
  ): Array<ChangeMessage<any, any>> {
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

  public get hasPendingTruncateReplacement(): boolean {
    return this.truncateReplacementPending
  }

  public get pendingTruncateReplacement(): Promise<void> | undefined {
    const completion = this.truncateReplaySession?.completion
    return completion?.isPending() ? completion.promise : undefined
  }

  public get hasFailedTruncateReplacement(): boolean {
    const completion = this.truncateReplaySession?.completion
    return (
      this.truncateReplacementPending &&
      completion !== undefined &&
      !completion.isPending()
    )
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
    if (this.unsubscribed) return
    if (this._status === newStatus) {
      return // No change
    }

    const previousStatus = this._status
    this._status = newStatus
    const revision = ++this.statusRevision

    // Emit status:change event
    this.emitInnerWhile(
      `status:change`,
      {
        type: `status:change`,
        subscription: this,
        previousStatus,
        status: newStatus,
      },
      () => this.statusRevision === revision,
    )

    // A listener may synchronously start or release demand. Do not follow that
    // newer transition with a stale specific event.
    if (this.statusRevision !== revision) return

    // Emit specific status event
    const eventKey: `status:${SubscriptionStatus}` = `status:${newStatus}`
    this.emitInnerWhile(
      eventKey,
      {
        type: eventKey,
        subscription: this,
        previousStatus,
        status: newStatus,
      } as SubscriptionEvents[typeof eventKey],
      () => this.statusRevision === revision,
    )
  }

  /** Observe an asynchronous subset load and restore status on settlement. */
  private observeLoadSubsetResult(
    syncResult: LoadSubsetRequestResult,
    demand: SubsetDemand,
    options: LoadSubsetOptions,
    trackStatus: boolean,
    shouldReportError: () => boolean = () => true,
  ): { demand: SubsetDemand; promise: Promise<unknown> } | undefined {
    if (!(syncResult instanceof Promise)) return

    const participant = { demand, promise: syncResult }

    if (trackStatus) {
      this.pendingLoadSubsetParticipants.add(participant)
      this.setStatus(`loadingSubset`)
    }

    const finish = () => {
      if (trackStatus) {
        this.pendingLoadSubsetParticipants.delete(participant)
        if (this.pendingLoadSubsetParticipants.size === 0) {
          this.setStatus(`ready`)
        }
      }
    }

    void syncResult.then(finish, (error: unknown) => {
      if (shouldReportError()) {
        this.recordLoadSubsetError(
          options,
          this.normalizeLoadSubsetPromiseError(syncResult, error),
        )
      }
      finish()
    })
    return trackStatus ? participant : undefined
  }

  /** Give every logical observer of one transport rejection the same Error. */
  private normalizeLoadSubsetPromiseError(
    promise: Promise<unknown>,
    error: unknown,
  ): Error {
    const existing = this.loadSubsetPromiseErrors.get(promise)
    if (existing) return existing
    const normalized = normalizeError(error)
    this.loadSubsetPromiseErrors.set(promise, normalized)
    return normalized
  }

  private stopStatusParticipant(
    participant:
      | { demand: SubsetDemand; promise: Promise<unknown> }
      | undefined,
  ): void {
    if (!participant) return
    this.pendingLoadSubsetParticipants.delete(participant)
    if (this.pendingLoadSubsetParticipants.size === 0) this.setStatus(`ready`)
  }

  private stopDemandStatusParticipants(demand: SubsetDemand): void {
    for (const participant of this.pendingLoadSubsetParticipants) {
      if (participant.demand === demand) {
        this.pendingLoadSubsetParticipants.delete(participant)
      }
    }
    if (this.pendingLoadSubsetParticipants.size === 0) this.setStatus(`ready`)
  }

  private loadSubset(
    options: LoadSubsetOptions,
    shouldReportError: () => boolean = () => true,
  ): LoadSubsetRequestResult {
    try {
      return this.collection._sync.loadSubset(options)
    } catch (error) {
      const normalized = normalizeError(error)
      if (shouldReportError()) this.recordLoadSubsetError(options, normalized)
      throw normalized
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
    const previous: SubsetAcquisition = {
      options: demand.options,
      abortController: demand.abortController,
      removeRequestAbortListener: demand.removeRequestAbortListener,
    }

    // Publish the replacement ownership before releasing the old lease. An
    // adapter may synchronously release the logical demand from unloadSubset;
    // that reentrant release must then see and release the new acquisition.
    demand.options = next.options
    demand.abortController = next.abortController
    demand.removeRequestAbortListener = next.removeRequestAbortListener
    try {
      this.collection._sync.unloadSubset(previous.options)
    } catch (error) {
      if (this.subsetDemands.includes(demand)) {
        demand.options = previous.options
        demand.abortController = previous.abortController
        demand.removeRequestAbortListener = previous.removeRequestAbortListener
      } else if (!this.releaseDebts.includes(previous)) {
        // Reentrant logical release already retired the replacement. Preserve
        // the old physical lease so teardown can retry its failed release.
        this.releaseDebts.push(previous)
      }
      throw error
    }
    previous.removeRequestAbortListener?.()
  }

  /** Abort and release one exact adapter acquisition. */
  private releaseSubsetAcquisition(
    acquisition: SubsetAcquisition,
    reportReleaseError = true,
  ): void {
    acquisition.abortController?.abort()
    try {
      this.collection._sync.unloadSubset(acquisition.options)
    } catch (error) {
      const normalized = reportReleaseError
        ? this.recordLoadSubsetError(
            acquisition.options,
            normalizeError(error),
            true,
          )
        : normalizeError(error)
      throw normalized
    } finally {
      acquisition.removeRequestAbortListener?.()
    }
  }

  /** Keep an exact lease visible until one release attempt succeeds. */
  private releaseOrRetainAcquisition(
    acquisition: SubsetAcquisition,
    reportReleaseError = this.primaryFailureDeliveryDepth === 0,
  ): void {
    if (!this.releaseDebts.includes(acquisition)) {
      this.releaseDebts.push(acquisition)
    }
    if (this.releasingAcquisitions.has(acquisition)) return
    this.releasingAcquisitions.add(acquisition)
    try {
      this.releaseSubsetAcquisition(acquisition, reportReleaseError)
      const index = this.releaseDebts.indexOf(acquisition)
      if (index !== -1) this.releaseDebts.splice(index, 1)
    } finally {
      this.releasingAcquisitions.delete(acquisition)
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
    }
    const acquisition = this.createSubsetAcquisition(demand)
    demand.options = acquisition.options
    demand.abortController = acquisition.abortController
    demand.removeRequestAbortListener = acquisition.removeRequestAbortListener
    const replaySession = this.truncateReplaySession
    const replayAttempt = replaySession?.currentAttempt
    // Reentrant release must see the exact acquisition before adapter work
    // starts. A genuine load throw removes this tentative logical owner below.
    this.subsetDemands.push(demand)
    try {
      const result = this.loadSubset(
        acquisition.options,
        () =>
          this.subsetDemands.includes(demand) &&
          (replaySession === undefined ||
            (this.truncateReplaySession === replaySession &&
              replaySession.currentAttempt === replayAttempt)),
      )
      if (
        this.subsetDemands.includes(demand) &&
        replaySession &&
        replayAttempt
      ) {
        this.trackTruncateReplayParticipant(
          replaySession,
          replayAttempt,
          demand,
          acquisition.options,
          result,
        )
      }
      return { demand, result }
    } catch (error) {
      const demandIndex = this.subsetDemands.indexOf(demand)
      if (demandIndex !== -1) {
        if (
          replaySession &&
          replayAttempt &&
          this.truncateReplaySession === replaySession &&
          replaySession.currentAttempt === replayAttempt
        ) {
          replayAttempt.failedDemands.add(demand)
        }
        this.subsetDemands.splice(demandIndex, 1)
        acquisition.abortController.abort()
        acquisition.removeRequestAbortListener?.()
      }
      throw error
    }
  }

  /** Re-check ownership after adapter and event callbacks that may reenter. */
  private isDemandActive(demand: SubsetDemand): boolean {
    return !this.unsubscribed && this.subsetDemands.includes(demand)
  }

  private recordLoadSubsetError(
    options: LoadSubsetOptions,
    error: unknown,
    reportAborted = false,
  ): Error {
    const normalized = normalizeError(error)
    // Aborted subset requests are obsolete demand, not load failures. The
    // request may reject after its route has already been released.
    if (options.signal?.aborted && !reportAborted) return normalized

    this._lastError = normalized
    this.primaryFailureDeliveryDepth++
    try {
      this.emitInner(`loadSubset:error`, {
        type: `loadSubset:error`,
        subscription: this,
        options,
        error: normalized,
      })
    } finally {
      this.primaryFailureDeliveryDepth--
    }
    return normalized
  }

  hasLoadedInitialState() {
    return this.loadedInitialState
  }

  hasSentAtLeastOneSnapshot() {
    return this.snapshotSent
  }

  emitEvents(changes: Array<ChangeMessage<any, any>>): boolean {
    if (this.unsubscribed) return false
    const newChanges = this.filterAndFlipChanges(changes)

    // Reconciliation can reduce a source delta to no visible change. Do not
    // wake subscribers for an empty semantic batch.
    if (changes.length > 0 && newChanges.length === 0) return false

    if (this.isBufferingForTruncate) {
      if (this.options.truncateReplayPublication) {
        return this.filteredCallback(newChanges)
      }
      // Buffer the changes instead of emitting immediately
      // This prevents a flash of missing content during truncate/refetch
      if (newChanges.length > 0) {
        this.applyPrivateChanges(this.truncateReplaySession!, newChanges)
      }
      return false
    } else {
      return this.filteredCallback(newChanges)
    }
  }

  /** Keep direct snapshot reads private while an authoritative replay is open. */
  private publishSnapshot(changes: Array<ChangeMessage<any, any>>): void {
    if (
      this.isBufferingForTruncate &&
      !this.options.truncateReplayPublication
    ) {
      if (changes.length > 0) {
        this.applyPrivateChanges(this.truncateReplaySession!, changes)
      }
      return
    }
    this.callback(changes)
  }

  /**
   * Sends the snapshot to the callback.
   * Returns a boolean indicating if it succeeded.
   * It can only fail if there is no index to fulfill the request
   * and the optimizedOnly option is set to true,
   * or, the entire state was already loaded.
   */
  requestSnapshot(opts?: RequestSnapshotOptions): boolean {
    if (this.unsubscribed) return false
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

    if (opts?.replaceExistingDemand) {
      if (!this.releaseMatchingDemand(loadOptions)) return false
    }

    const { demand, result: syncResult } = this.startSubsetDemand(loadOptions)
    if (!this.isDemandActive(demand)) return false
    if (opts?.where) this.requestedSubsetWhere.set(loadOptions, opts.where)

    // Pass the raw loadSubset result to the caller for external tracking
    opts?.onLoadSubsetResult?.(
      syncResult,
      demand.options,
      (primaryFailure) => this.releaseDemand(demand, primaryFailure),
    )
    if (!this.isDemandActive(demand)) return false

    this.observeLoadSubsetResult(
      syncResult,
      demand,
      demand.options,
      opts?.trackLoadSubsetPromise ?? true,
    )
    if (!this.isDemandActive(demand)) return false

    // Also load data immediately from the collection
    let snapshot: Array<ChangeMessage<any, any>> | void
    if (opts?.onUnoptimized) {
      snapshot = this.collection.currentStateAsChanges({
        ...stateOpts,
        optimizedOnly: true,
      })
      if (snapshot === undefined) {
        opts.onUnoptimized()
        if (this.unsubscribed) return false
        snapshot = this.collection.currentStateAsChanges({
          ...stateOpts,
          optimizedOnly: false,
        })
      }
    } else {
      snapshot = this.collection.currentStateAsChanges(stateOpts)
    }
    if (this.unsubscribed) return false

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
    this.publishSnapshot(filteredSnapshot)
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

    this.releaseDemandAt(index)
  }

  /** Release the exact acquisition returned to an internal request observer. */
  releaseLoadSubset(
    options: LoadSubsetOptions,
    primaryFailure?: { error: unknown },
  ): void {
    const demand = this.subsetDemands.find(
      (candidate) => candidate.options === options,
    )
    if (demand) {
      this.releaseDemand(demand, primaryFailure)
    } else if (primaryFailure) {
      this.recordLoadSubsetError(options, primaryFailure.error, true)
    }
  }

  private releaseDemand(
    demand: SubsetDemand,
    primaryFailure?: { error: unknown },
  ): void {
    if (!primaryFailure) {
      const index = this.subsetDemands.indexOf(demand)
      if (index !== -1) this.releaseDemandAt(index)
      return
    }

    try {
      this.recordLoadSubsetError(demand.options, primaryFailure.error, true)
    } finally {
      // The failed request remains the public error. A release failure is
      // retained as cleanup debt and may be reported if that later retry fails.
      const index = this.subsetDemands.indexOf(demand)
      if (index !== -1) this.releaseDemandAt(index, false)
    }
  }

  private releaseMatchingDemand(options: LoadSubsetOptions): boolean {
    const key = getLoadSubsetDemandKey(options)
    const index = this.subsetDemands.findIndex(
      (demand) => getLoadSubsetDemandKey(demand.requestOptions) === key,
    )
    if (index !== -1) this.releaseDemandAt(index)
    return !this.unsubscribed
  }

  private releaseDemandAt(
    index: number,
    reportReleaseError = this.primaryFailureDeliveryDepth === 0,
  ): void {
    const demand = this.subsetDemands[index]
    if (!demand) return
    const replaySession = this.truncateReplaySession
    const acquisition: SubsetAcquisition = {
      options: demand.options,
      abortController: demand.abortController,
      removeRequestAbortListener: demand.removeRequestAbortListener,
    }
    this.subsetDemands.splice(index, 1)
    runAllCallbacks([
      () => this.removeTruncateReplayParticipant(demand),
      () => this.pruneReleasedReplayRows(),
      // Adapter release is a supported reentrancy boundary. A demand started
      // from unload joins this replacement before completion is decided.
      () =>
        this.releaseOrRetainAcquisition(acquisition, reportReleaseError),
      () => this.retireEmptyReplay(),
      () => {
        if (replaySession) this.checkTruncateReplayComplete(replaySession)
      },
      // Ready follows replacement publication, never the delete half of it.
      () => this.stopDemandStatusParticipants(demand),
    ])
  }

  /** A replay with no remaining logical demand cannot establish more rows. */
  private retireEmptyReplay(): void {
    if (this.subsetDemands.length !== 0 || !this.truncateReplaySession) {
      return
    }
    if (this.truncateReplaySession.completion.isPending()) {
      this.truncateReplaySession.completion.reject(
        new LoadSubsetOperationAbortedError(),
      )
    }
    this.truncateReplaySession = undefined
    this.truncateReplacementPending = false
    this.stalePublishedRows.clear()
    this.restorePublishedSnapshotTracking()
    this.options.truncateReplayPublication?.succeed()
  }

  /** Remove rows owned only by a demand released during private replay. */
  private pruneReleasedReplayRows(): void {
    const session = this.truncateReplaySession
    if (!session) return
    const filters = this.subsetDemands.map((demand) =>
      demand.requestOptions.where
        ? createFilterFunctionFromExpression(demand.requestOptions.where)
        : undefined,
    )
    const deletes = [...this.publishedRows]
      .filter(([, value]) =>
        filters.every((filter) => !(filter?.(value) ?? true)),
      )
      .map(
        ([key, value]): ChangeMessage<any, any> => ({
          type: `delete`,
          key,
          value,
        }),
      )
    if (deletes.length === 0) return

    for (const { key } of deletes) {
      session.publicationState.publishedRows.delete(key)
      session.publicationState.sentKeys.delete(key)
      // A fully loaded snapshot normally stops per-change sent-key tracking.
      // Release still retires these keys, so a later demand must be able to
      // publish them again from the retained source state.
      this.sentKeys.delete(key)
    }
    this.filteredCallback(deletes)
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
    if (this.unsubscribed) return
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

    this.publishSnapshot(changes)
    if (this.unsubscribed) return

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
        const whereCurrentCursor = buildCursorCurrent(orderBy, minValues)
        if (whereCurrentCursor) {
          cursorExpressions = {
            whereFrom: whereFromCursor,
            whereCurrent: whereCurrentCursor,
            lastKey: this.lastSentKey,
          }
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
    if (!this.isDemandActive(demand)) return

    // Pass the raw loadSubset result to the caller for external tracking
    onLoadSubsetResult?.(
      syncResult,
      demand.options,
      (primaryFailure) => this.releaseDemand(demand, primaryFailure),
    )
    if (!this.isDemandActive(demand)) return
    this.observeLoadSubsetResult(
      syncResult,
      demand,
      demand.options,
      shouldTrackLoadSubsetPromise,
    )
    if (!this.isDemandActive(demand)) return
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
    if (this.unsubscribed) {
      let firstCleanupError: unknown
      for (const acquisition of [...this.releaseDebts]) {
        if (!this.releaseDebts.includes(acquisition)) continue
        try {
          this.releaseOrRetainAcquisition(acquisition)
        } catch (error) {
          firstCleanupError ??= error
        }
      }
      if (firstCleanupError !== undefined) throw firstCleanupError
      return
    }
    this.unsubscribed = true
    // Stop any status listener set already being iterated. Clearing the
    // emitter's map cannot invalidate that captured Set by itself.
    this.statusRevision++
    let firstCleanupError: unknown

    // Clean up truncate event listener
    try {
      this.truncateCleanup?.()
    } catch (error) {
      firstCleanupError = error
    }
    this.truncateCleanup = undefined

    // Stop any buffered replay from publishing after unsubscription.
    if (this.truncateReplaySession?.completion.isPending()) {
      this.truncateReplaySession.completion.reject(
        new LoadSubsetOperationAbortedError(),
      )
    }
    this.truncateReplaySession = undefined
    this.truncateReplacementPending = false
    this.stalePublishedRows.clear()

    // Logical demand ends now even if a physical adapter release must be
    // retried. Keeping those states separate prevents retired demand from
    // joining a later truncate replay.
    const acquisitions: Array<SubsetAcquisition> = [
      ...this.releaseDebts,
      ...this.subsetDemands,
    ]
    for (const demand of this.subsetDemands) {
      this.stopDemandStatusParticipants(demand)
    }
    this.subsetDemands = []
    for (const acquisition of acquisitions) {
      if (!this.releaseDebts.includes(acquisition)) {
        this.releaseDebts.push(acquisition)
      }
    }
    for (const acquisition of acquisitions) {
      if (!this.releaseDebts.includes(acquisition)) continue
      try {
        this.releaseOrRetainAcquisition(acquisition)
      } catch (error) {
        firstCleanupError ??= error
      }
    }

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
