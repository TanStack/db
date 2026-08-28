import { ensureIndexForExpression } from '../indexes/auto-index.js'
import { and, gte, lt } from '../query/builder/functions.js'
import { Value } from '../query/ir.js'
import { EventEmitter } from '../event-emitter.js'
import {
  getSyncRequestProvenance,
  isLoadSubsetRequestSignalFor,
} from '../load-subset-request-provenance.js'
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

type OrderedPublicationState = {
  prefixSize: number
  boundary: TotalOrderBoundary | undefined
  /** Rows authorized to participate in this ordered publication. */
  candidateRows: Map<string | number, object>
}

type PublicationState = {
  loadedInitialState: boolean
  snapshotSent: boolean
  sentKeys: Set<string | number>
  publishedRows: Map<string | number, object>
  ordered: OrderedPublicationState | undefined
}

type OrderedAcquisitionState = Readonly<{
  requestedPrefix: number
  hadBoundary: boolean
  requiresUnboundedRefinement: boolean
  revision: number
}>

type SubsetAcquisition = {
  options: LoadSubsetOptions
  ordered?: OrderedAcquisitionState
  abortController?: AbortController
  removeRequestAbortListener?: () => void
}

type ReplaySubsetAcquisition = SubsetAcquisition & {
  abortController: AbortController
}

type SubsetDemand = SubsetAcquisition & {
  requestOptions: LoadSubsetOptions
  onLoadSubsetResult?: (
    result: LoadSubsetRequestResult,
    demand: LoadSubsetOptions,
  ) => void
  pendingReplayAcquisitions: Set<ReplaySubsetAcquisition>
  /** Logical ownership; failed unloads may retain an inactive cleanup debt. */
  active: boolean
  /** Prevent adapter cleanup from releasing the same acquisition reentrantly. */
  releaseInProgress: boolean
  releaseFailed: boolean
  releaseSettled: boolean
}

type TruncateReplayAttempt = {
  pending: Set<{ promise: Promise<unknown> }>
  failed: boolean
  setupComplete: boolean
}

type TruncateReplaySession = {
  publicationState: PublicationState
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
  // One object owns the last complete ordered publication. A failed replay
  // retains the full publication state instead of reconstructing it from
  // parallel offset, key, and boundary fields.
  private orderedPublication: OrderedPublicationState | undefined
  private stalePublication: PublicationState | undefined

  private filteredCallback: (changes: Array<ChangeMessage<any, any>>) => boolean

  private orderByIndex: IndexInterface<string | number> | undefined
  private orderedWindow: WindowState | undefined

  // Status tracking
  private _status: SubscriptionStatus = `ready`
  private _lastError: unknown | undefined
  private unsubscribed = false
  private pendingLoadSubsetPromises: Set<Promise<unknown>> = new Set()
  // Cleanup function for truncate event listener
  private truncateCleanup: (() => void) | undefined

  // One replay session owns the publication baseline, overlapping attempts,
  // and buffered changes until every attempt settles.
  private truncateReplaySession: TruncateReplaySession | undefined

  private isActiveDemand(demand: SubsetDemand): boolean {
    return demand.active && this.subsetDemands.includes(demand)
  }

  /** Consume only a possible rejection once arbitrary code retires a demand. */
  private ignoreObsoleteSubsetResult(
    demand: SubsetDemand,
    result: LoadSubsetRequestResult,
  ): boolean {
    if (this.isActiveDemand(demand)) return false
    if (result instanceof Promise) void result.catch(() => {})
    return true
  }

  private hasActiveOrderedDemand(): boolean {
    return this.subsetDemands.some(
      (demand) => demand.active && demand.ordered !== undefined,
    )
  }

  private activeAdditionalFilters(): Array<(row: object) => boolean> {
    return this.subsetDemands
      .filter((demand) => demand.active && demand.ordered === undefined)
      .map((demand) =>
        demand.requestOptions.where
          ? createFilterFunctionFromExpression<object>(
              demand.requestOptions.where,
            )
          : () => true,
      )
  }

  private diffPublishedRows(
    desired: ReadonlyMap<string | number, object>,
  ): Array<ChangeMessage<any, any>> {
    const changes: Array<ChangeMessage<any, any>> = []
    for (const [key, previousValue] of this.publishedRows) {
      const value = desired.get(key)
      if (value === undefined) {
        changes.push({ type: `delete`, key, value: previousValue })
      } else if (!deepEquals(value, previousValue)) {
        changes.push({ type: `update`, key, value, previousValue })
      }
    }
    for (const [key, value] of desired) {
      if (!this.publishedRows.has(key)) {
        changes.push({ type: `insert`, key, value })
      }
    }
    return changes
  }

  /** Keep every retained replay baseline equal to what consumers still see. */
  private synchronizeRetainedPublication(): void {
    if (this.stalePublication) {
      this.stalePublication.publishedRows = new Map(this.publishedRows)
      this.stalePublication.sentKeys = new Set(this.sentKeys)
      this.stalePublication.ordered = undefined
      if (this.stalePublication.publishedRows.size === 0) {
        this.stalePublication = undefined
      }
    }
    if (this.truncateReplaySession) {
      const publication = this.truncateReplaySession.publicationState
      publication.publishedRows = new Map(this.publishedRows)
      publication.sentKeys = new Set(this.sentKeys)
      publication.ordered = undefined
    }
  }

  /** Remove ordered authority and its exclusive rows when its last owner leaves. */
  private retireUnownedOrderedPublication(): void {
    if (!this.orderedWindow || this.hasActiveOrderedDemand()) return

    const additionalFilters = this.activeAdditionalFilters()
    const desired = new Map(
      [...this.publishedRows].filter(([, row]) =>
        additionalFilters.some((filter) => filter(row)),
      ),
    )
    this.orderedWindow.resetCoverage()
    this.orderedPublication = undefined
    if (this.stalePublication) this.stalePublication.ordered = undefined
    if (this.truncateReplaySession) {
      this.truncateReplaySession.publicationState.ordered = undefined
    }
    const changes = this.diffPublishedRows(desired)
    if (changes.length > 0) this.callback(changes)
    this.synchronizeRetainedPublication()
  }

  /** Forget inactive demand state after every owned adapter lease is gone. */
  private collectReleasedDemand(demand: SubsetDemand): void {
    if (
      demand.active ||
      demand.releaseInProgress ||
      !demand.releaseSettled ||
      demand.pendingReplayAcquisitions.size > 0
    ) {
      return
    }
    const index = this.subsetDemands.indexOf(demand)
    if (index !== -1) this.subsetDemands.splice(index, 1)
  }

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
      this.refreshOrderedPublication()
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
    const demandsToReload = this.subsetDemands.filter((demand) => demand.active)

    // Only buffer if there's an actual loadSubset handler that can do async work.
    // Without a loadSubset handler, there's nothing to re-request and no reason to buffer.
    // This prevents unnecessary buffering in eager sync mode or when loadSubset isn't implemented.
    const hasLoadSubsetHandler = this.collection._sync.syncLoadSubsetFn !== null

    // If there are no subsets to reload OR no loadSubset handler, just reset state
    if (demandsToReload.length === 0 || !hasLoadSubsetHandler) {
      this.snapshotSent = false
      this.loadedInitialState = false
      this.orderedPublication = undefined
      this.stalePublication = undefined
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
          ordered:
            this.orderedPublication === undefined
              ? undefined
              : {
                  ...this.orderedPublication,
                  candidateRows: new Map(this.orderedPublication.candidateRows),
                },
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

    // Defer the requests so the truncate commit's deletes enter the session
    // buffer before a synchronous adapter can publish replacement rows.
    queueMicrotask(() => {
      if (this.truncateReplaySession !== session) return

      const synchronousErrors: Array<{
        options: LoadSubsetOptions
        error: unknown
      }> = []

      for (const demand of demandsToReload) {
        if (!this.isActiveDemand(demand)) continue

        const isCurrentAttempt = () =>
          this.truncateReplaySession === session &&
          session.currentAttempt === attempt
        const nextAcquisition = this.createSubsetAcquisition(demand, true)
        demand.pendingReplayAcquisitions.add(nextAcquisition)
        let syncResult: LoadSubsetRequestResult
        try {
          syncResult = this.collection._sync.loadSubset(nextAcquisition.options)
        } catch (error) {
          const shouldReportError =
            isCurrentAttempt() && !nextAcquisition.options.signal?.aborted
          demand.pendingReplayAcquisitions.delete(nextAcquisition)
          nextAcquisition.abortController.abort()
          nextAcquisition.removeRequestAbortListener?.()
          attempt.failed = true
          if (shouldReportError) {
            synchronousErrors.push({
              options: nextAcquisition.options,
              error,
            })
          }
          continue
        }

        let ownsReplacement = false
        let shouldReportSettledError = false
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
                this.isActiveDemand(demand) &&
                !nextAcquisition.options.signal?.aborted
              shouldReportSettledError = failedCurrentDemand
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
          this.observeOrderedCoverage(
            syncResult,
            demand,
            nextAcquisition,
            () => ownsReplacement,
          )
        }

        // Register this after ordered coverage so replay publication cannot
        // overtake its boundary evidence on the same promise.
        this.trackTruncateReplayResult(session, attempt, syncResult, () => {
          // A released demand no longer participates in the current
          // replacement. Its cooperative AbortError must not discard the
          // successful rows from demands that are still active.
          return (
            this.isActiveDemand(demand) &&
            !nextAcquisition.options.signal?.aborted
          )
        })
        // Readiness and errors are observable callbacks. Register them only
        // after replacement ownership, ordered evidence, and replay
        // publication so listeners cannot reenter a half-settled replay.
        this.observeLoadSubsetResult(
          syncResult,
          nextAcquisition.options,
          true,
          () => shouldReportSettledError,
          true,
        )
        // Preserve the original demand's consumer-local in-flight guard. This
        // observer is registered last so its settlement sees replay ownership,
        // coverage, and attempt bookkeeping before it may continue the window.
        demand.onLoadSubsetResult?.(syncResult, nextAcquisition.options)
      }

      attempt.setupComplete = true
      this.checkTruncateReplayComplete(session)
      // Synchronous adapter errors cannot be emitted until replay restoration
      // has discarded its private buffer. Reentrant recovery then starts in a
      // stable publication epoch just like asynchronous rejection recovery.
      for (const { options, error } of synchronousErrors) {
        this.recordLoadSubsetError(options, error, true)
      }
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
      return
    }
    // A fulfilled page can still say that more ordered rows exist. Keep the
    // old publication until a continuation proves the whole retained prefix;
    // request settlement alone is not a safe replacement boundary.
    if (
      this.orderedWindow &&
      this.hasActiveOrderedDemand() &&
      !this.orderedWindow.coversRetainedWindow
    ) {
      return
    }
    this.flushTruncateReplay(session)
  }

  /**
   * Discard an incomplete current replay and restore the last publication.
   * Rows in that publication remain stale until a later source delta or replay
   * reconciles them with the source collection.
   */
  private abandonTruncateReplay(session: TruncateReplaySession): void {
    if (this.truncateReplaySession !== session) return
    const publicationState = session.publicationState
    // Evidence established by the rejected source generation cannot satisfy a
    // later consumer guard. The retained publication remains public, but the
    // next acquisition must prove coverage again.
    this.orderedWindow?.resetCoverage()
    this.loadedInitialState = publicationState.loadedInitialState
    this.snapshotSent = publicationState.snapshotSent
    this.sentKeys = new Set(publicationState.sentKeys)
    this.publishedRows = new Map(publicationState.publishedRows)
    this.orderedPublication = publicationState.ordered
    this.stalePublication = publicationState
    this.truncateReplaySession = undefined
  }

  /** Publish the complete buffered replacement as one subscriber batch. */
  private flushTruncateReplay(session: TruncateReplaySession): void {
    if (this.truncateReplaySession !== session) return
    this.truncateReplaySession = undefined

    const retainedDeletes = [
      ...(this.stalePublication?.publishedRows ?? []),
    ].map(
      ([key, value]): ChangeMessage<any, any> => ({
        type: `delete`,
        key,
        value,
      }),
    )
    this.stalePublication = undefined

    const merged = [...session.buffer.flat(), ...retainedDeletes]
    const activeDemandFilters = this.subsetDemands
      .filter((demand) => demand.active)
      .map((demand) =>
        demand.requestOptions.where
          ? createFilterFunctionFromExpression(demand.requestOptions.where)
          : undefined,
      )
    // The raw replay buffer can contain rows retained for another demand or
    // outside the ordered prefix. Publish the settled ordered reconciliation
    // as the replacement's one atomic batch.
    const replacement = this.orderedWindow
      ? this.reconcileOrderedWindow()
      : this.createPublicationDiff(
          session.publicationState.publishedRows,
          merged,
          (value) =>
            activeDemandFilters.some((filter) => filter?.(value) ?? true),
        )
    if (replacement.length > 0) this.filteredCallback(replacement)
    // Buffering records every source key before active-demand filtering. Reset
    // the dedupe set to what the subscriber actually received so a later
    // request can publish a row that belonged only to a released demand.
    this.sentKeys = new Set(this.publishedRows.keys())
    this.refreshOrderedPublication()
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
    // Retain the new target now, but let the replacement epoch reconcile and
    // publish it together with the buffered source rows.
    if (this.isBufferingForTruncate) {
      return false
    }
    if (this.stalePublication?.ordered) {
      const changes = this.reconcileStaleOrderedPublication([])
      if (changes.length === 0) return false
      this.callback(changes)
      return true
    }
    const changes = this.reconcileOrderedWindow()
    if (changes.length === 0) return false
    this.callback(changes)
    return true
  }

  get orderedRowsNeeded(): number {
    return this.hasActiveOrderedDemand()
      ? (this.orderedWindow?.rowsNeeded() ?? 0)
      : 0
  }

  get orderedRetainedWindowSize(): number {
    return this.orderedWindow?.retainedPrefixSize ?? 0
  }

  get requiresOrderedPrefixRefresh(): boolean {
    return this.orderedWindow?.requiresPrefixRefresh ?? false
  }

  get hasOrderedCoverageForActiveWindow(): boolean {
    return (
      this.hasActiveOrderedDemand() &&
      (this.orderedWindow?.coversActiveWindow ?? false)
    )
  }

  get orderedBoundaryRow(): object | undefined {
    if (!this.hasActiveOrderedDemand()) return undefined
    const boundary = this.retainedOrderedPublication
      ? this.orderedBoundary()
      : this.orderedWindow?.progressBoundary()
    return boundary === undefined
      ? undefined
      : (this.publishedRows.get(boundary.key) ??
          this.collection.get(boundary.key))
  }

  get orderedBoundaryKey(): string | number | undefined {
    if (!this.hasActiveOrderedDemand()) return undefined
    return (
      this.retainedOrderedPublication
        ? this.orderedBoundary()
        : this.orderedWindow?.progressBoundary()
    )?.key
  }

  private orderedBoundary() {
    const retainedPublication = this.retainedOrderedPublication
    return retainedPublication === undefined
      ? this.orderedWindow?.boundary()
      : retainedPublication.boundary
  }

  private get retainedOrderedPublication():
    | OrderedPublicationState
    | undefined {
    return (
      this.truncateReplaySession?.publicationState.ordered ??
      this.stalePublication?.ordered
    )
  }

  private reconcileOrderedWindow(): Array<ChangeMessage<any, any>> {
    if (!this.orderedWindow) return []
    const additionalFilters = this.activeAdditionalFilters()
    const changes = this.orderedWindow.reconcile(
      this.publishedRows,
      additionalFilters.length === 0
        ? undefined
        : (row) => additionalFilters.some((filter) => filter(row)),
    )
    this.refreshOrderedPublication()
    return changes
  }

  /**
   * Evolve a failed replay's last good ordered publication without admitting
   * rows installed by the rejected replacement. Later source deltas form a
   * new, isolated candidate set around that public baseline. Keeping this
   * state even when the public prefix is empty prevents private replay progress
   * from becoming a cursor or publication boundary.
   */
  private reconcileStaleOrderedPublication(
    changes: ReadonlyArray<ChangeMessage<any, string | number>>,
    source:
      | `ordered-source`
      | `additional-demand`
      | ((
          change: ChangeMessage<any, string | number>,
        ) => `ordered-source` | `additional-demand`) = `ordered-source`,
  ): Array<ChangeMessage<any, any>> {
    const stalePublication = this.stalePublication
    const ordered = stalePublication?.ordered
    const window = this.orderedWindow
    if (!stalePublication || !ordered || !window) return []

    const orderedFilter = this.options.whereExpression
      ? createFilterFunctionFromExpression(this.options.whereExpression)
      : undefined
    const additionalFilters = this.activeAdditionalFilters()
    const isOrderedRow = (row: object) => orderedFilter?.(row) ?? true
    const isAdditionalRow = (row: object) =>
      additionalFilters.some((filter) => filter(row))
    const orderedCandidates = ordered.candidateRows

    for (const change of changes) {
      const changeSource =
        typeof source === `function` ? source(change) : source
      const admitsOrderedCandidates = changeSource === `ordered-source`
      if (change.type === `delete`) {
        stalePublication.publishedRows.delete(change.key)
        orderedCandidates.delete(change.key)
      } else {
        if (admitsOrderedCandidates) {
          if (isOrderedRow(change.value)) {
            orderedCandidates.set(change.key, change.value)
          } else {
            orderedCandidates.delete(change.key)
          }
        } else {
          const candidate = orderedCandidates.get(change.key)
          if (candidate !== undefined && !deepEquals(candidate, change.value)) {
            // Additional visibility may replace the collection's current row,
            // but it cannot transfer ordered authority from an older version.
            orderedCandidates.delete(change.key)
          }
        }
        if (
          orderedCandidates.has(change.key) ||
          isAdditionalRow(change.value)
        ) {
          stalePublication.publishedRows.set(change.key, change.value)
        } else {
          stalePublication.publishedRows.delete(change.key)
        }
      }
    }
    for (const [key, row] of stalePublication.publishedRows) {
      if (!orderedCandidates.has(key) && !isAdditionalRow(row)) {
        stalePublication.publishedRows.delete(key)
      }
    }

    const orderedRows = [...orderedCandidates]
      .sort((left, right) => window.totalOrder.compareEntries(left, right))
      .slice(0, window.retainedPrefixSize)
    const desired = new Map<string | number, object>(orderedRows)
    if (additionalFilters.length > 0) {
      for (const [key, row] of stalePublication.publishedRows) {
        if (isAdditionalRow(row)) desired.set(key, row)
      }
    }

    const lastOrderedRow = orderedRows.at(-1)
    const nextOrderedPublication: OrderedPublicationState = {
      prefixSize: orderedRows.length,
      boundary:
        lastOrderedRow === undefined
          ? undefined
          : window.totalOrder.boundary(lastOrderedRow[1], lastOrderedRow[0]),
      candidateRows: orderedCandidates,
    }
    stalePublication.ordered = nextOrderedPublication
    this.orderedPublication = {
      ...nextOrderedPublication,
      candidateRows: new Map(orderedCandidates),
    }

    const reconciled: Array<ChangeMessage<any, any>> = []
    for (const [key, previousValue] of this.publishedRows) {
      const value = desired.get(key)
      if (value === undefined) {
        reconciled.push({ type: `delete`, key, value: previousValue })
      } else if (!deepEquals(value, previousValue)) {
        reconciled.push({ type: `update`, key, value, previousValue })
      }
    }
    for (const [key, value] of desired) {
      if (!this.publishedRows.has(key)) {
        reconciled.push({ type: `insert`, key, value })
      }
    }
    return reconciled
  }

  /** Capture the exact continuation state of the last complete publication. */
  private refreshOrderedPublication(): void {
    if (
      !this.orderedWindow ||
      !this.hasActiveOrderedDemand() ||
      this.isBufferingForTruncate ||
      this.stalePublication
    ) {
      return
    }
    const publicationEntries = this.orderedWindow.publicationEntries()
    const lastEntry = publicationEntries.at(-1)
    this.orderedPublication = {
      prefixSize: publicationEntries.length,
      boundary:
        lastEntry === undefined
          ? undefined
          : this.orderedWindow.totalOrder.boundary(lastEntry[1], lastEntry[0]),
      candidateRows: new Map(publicationEntries),
    }
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
    reportAborted = false,
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
      if (shouldReportError()) {
        this.recordLoadSubsetError(options, error, reportAborted)
      }
      finish()
    })
  }

  private staleChangeSource(
    change: ChangeMessage<any, any>,
  ): `ordered-source` | `additional-demand` {
    const provenance = getSyncRequestProvenance(change)
    if (provenance === undefined || provenance.hasOrdinarySource) {
      return `ordered-source`
    }

    for (const requestSignal of provenance.requestSignals) {
      for (const demand of this.subsetDemands) {
        if (!demand.active) continue
        if (
          demand.options.signal !== undefined &&
          !demand.options.signal.aborted &&
          isLoadSubsetRequestSignalFor(requestSignal, demand.options.signal)
        ) {
          if (demand.ordered !== undefined) return `ordered-source`
        }
        for (const pending of demand.pendingReplayAcquisitions) {
          if (
            pending.options.signal !== undefined &&
            !pending.options.signal.aborted &&
            isLoadSubsetRequestSignalFor(requestSignal, pending.options.signal)
          ) {
            if (pending.ordered !== undefined) return `ordered-source`
          }
        }
      }
    }
    // A tagged request that has no active ordered owner here may belong to an
    // unordered, released, or peer demand. None may mint ordered authority for
    // this subscription. Untagged transactions took the ordinary branch above.
    return `additional-demand`
  }

  private buildOrderedCursorExpressions(
    orderBy: OrderBy,
    cursorValues: ReadonlyArray<unknown> | undefined,
    lastKey: string | number | undefined,
  ): {
    cursor: LoadSubsetOptions[`cursor`]
    requiresUnboundedRefinement: boolean
  } {
    if (cursorValues === undefined || cursorValues.length === 0) {
      return { cursor: undefined, requiresUnboundedRefinement: false }
    }

    if (!canExpressCursorOrder(orderBy, cursorValues)) {
      return { cursor: undefined, requiresUnboundedRefinement: true }
    }

    const whereFrom = buildCursor(orderBy, [...cursorValues])
    if (!whereFrom) {
      return { cursor: undefined, requiresUnboundedRefinement: false }
    }

    const { expression } = orderBy[0]!
    const cursorMinValue = cursorValues[0]
    // A JS Date represents a 1ms range while some backends retain finer
    // precision, so equality must cover that complete interval.
    const whereCurrent =
      cursorMinValue instanceof Date
        ? and(
            gte(expression, new Value(cursorMinValue)),
            lt(expression, new Value(new Date(cursorMinValue.getTime() + 1))),
          )
        : buildCursorEquality(expression, cursorMinValue)

    return {
      cursor: { whereFrom, whereCurrent, lastKey },
      requiresUnboundedRefinement: false,
    }
  }

  /** Rebuild ordered transport and evidence from this replacement generation. */
  private createReplayRequest(demand: SubsetDemand): {
    options: LoadSubsetOptions
    ordered: OrderedAcquisitionState | undefined
  } {
    const ordered = demand.ordered
    const window = this.orderedWindow
    const orderBy = demand.requestOptions.orderBy
    if (!ordered || !window || !orderBy) {
      return { options: demand.requestOptions, ordered }
    }

    const boundary = window.requestBoundary()
    const builtCursor = this.buildOrderedCursorExpressions(
      orderBy,
      boundary?.values,
      boundary?.key,
    )
    const requiresUnboundedRefinement =
      ordered.requiresUnboundedRefinement ||
      window.requiresFullRefinement ||
      builtCursor.requiresUnboundedRefinement
    const currentOffset = window.localPrefixSize
    const limit = demand.requestOptions.limit
    const replayOrdered: OrderedAcquisitionState = {
      requestedPrefix:
        limit === undefined ? ordered.requestedPrefix : currentOffset + limit,
      hadBoundary: boundary !== undefined,
      requiresUnboundedRefinement,
      revision: window.coverageRevision,
    }

    if (requiresUnboundedRefinement) {
      return {
        options: {
          where: demand.requestOptions.where,
          orderBy,
          subscription: demand.requestOptions.subscription,
        },
        ordered: replayOrdered,
      }
    }

    return {
      options: {
        ...demand.requestOptions,
        cursor: builtCursor.cursor,
        offset: currentOffset,
      },
      ordered: replayOrdered,
    }
  }

  /** Create a fresh, abortable adapter acquisition for a replay generation. */
  private createSubsetAcquisition(
    demand: SubsetDemand,
    replay = false,
  ): SubsetAcquisition & { abortController: AbortController } {
    const abortController = new AbortController()
    const requestSignal = demand.requestOptions.signal
    const request = replay
      ? this.createReplayRequest(demand)
      : { options: demand.requestOptions, ordered: demand.ordered }
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
        ...request.options,
        signal: abortController.signal,
      },
      ordered: request.ordered,
      abortController,
      removeRequestAbortListener,
    }
  }

  /** Replace the adapter lease held for one logical subset demand. */
  private replaceSubsetAcquisition(
    demand: SubsetDemand,
    next: SubsetAcquisition & { abortController: AbortController },
  ): boolean {
    if (demand.releaseInProgress) return false
    demand.releaseInProgress = true
    const previousOptions = demand.options
    const removePreviousAbortListener = demand.removeRequestAbortListener
    try {
      this.collection._sync.unloadSubset(previousOptions)
      removePreviousAbortListener?.()
      demand.releaseFailed = false
      demand.releaseSettled = true

      // unloadSubset is user adapter code and may synchronously release the
      // logical demand. In that case the replacement must never become its
      // new live acquisition.
      if (!this.isActiveDemand(demand)) {
        this.releaseReplayAcquisitionUnprotected(demand, next)
        return false
      }

      demand.options = next.options
      demand.ordered = next.ordered
      demand.abortController = next.abortController
      demand.removeRequestAbortListener = next.removeRequestAbortListener
      demand.releaseSettled = false
      return true
    } finally {
      demand.releaseInProgress = false
      this.collectReleasedDemand(demand)
    }
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
      this.isActiveDemand(demand) &&
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
      const installed = this.replaceSubsetAcquisition(demand, next)
      if (installed) demand.pendingReplayAcquisitions.delete(next)
      return installed
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
    if (demand.releaseInProgress) return
    demand.releaseInProgress = true
    try {
      this.releaseReplayAcquisitionUnprotected(demand, next)
    } finally {
      demand.releaseInProgress = false
      this.collectReleasedDemand(demand)
    }
  }

  private releaseReplayAcquisitionUnprotected(
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
    if (demand.releaseInProgress) return
    demand.releaseInProgress = true
    try {
      demand.abortController?.abort()
      let firstReleaseError: unknown
      for (const pending of [...demand.pendingReplayAcquisitions]) {
        try {
          this.releaseReplayAcquisitionUnprotected(demand, pending)
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
    } finally {
      demand.releaseInProgress = false
      this.collectReleasedDemand(demand)
    }
  }

  /** Start and retain the first acquisition for one logical subset demand. */
  private startSubsetDemand(
    requestOptions: LoadSubsetOptions,
    ordered?: SubsetDemand[`ordered`],
  ): {
    demand: SubsetDemand
    acquisition: SubsetAcquisition & { abortController: AbortController }
    result: LoadSubsetRequestResult
  } {
    const demand: SubsetDemand = {
      requestOptions,
      options: requestOptions,
      ...(ordered === undefined ? {} : { ordered }),
      pendingReplayAcquisitions: new Set(),
      active: true,
      releaseInProgress: false,
      releaseFailed: false,
      releaseSettled: false,
    }
    const acquisition = this.createSubsetAcquisition(demand)
    demand.options = acquisition.options
    demand.ordered = acquisition.ordered
    demand.abortController = acquisition.abortController
    demand.removeRequestAbortListener = acquisition.removeRequestAbortListener
    if (acquisition.abortController.signal.aborted) {
      acquisition.removeRequestAbortListener?.()
      return { demand, acquisition, result: true }
    }
    // Reentrant release must see the exact acquisition before adapter work
    // starts. A genuine load throw removes this tentative logical owner below.
    this.subsetDemands.push(demand)
    try {
      // A synchronous start failure is not observable until the tentative
      // owner has rolled back. Otherwise an error listener can reenter release
      // and unload a request that never established an acquisition.
      const result = this.collection._sync.loadSubset(acquisition.options)
      return { demand, acquisition, result }
    } catch (error) {
      const shouldReportError = !acquisition.options.signal?.aborted
      const demandIndex = this.subsetDemands.indexOf(demand)
      if (demandIndex !== -1 && !demand.releaseFailed) {
        this.subsetDemands.splice(demandIndex, 1)
        acquisition.abortController.abort()
        acquisition.removeRequestAbortListener?.()
      }
      if (shouldReportError) {
        this.recordLoadSubsetError(acquisition.options, error, true)
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
      this.hasActiveOrderedDemand() &&
      !this.isBufferingForTruncate &&
      this.stalePublication?.ordered
    ) {
      const orderedChanges = this.reconcileStaleOrderedPublication(
        changes,
        (change) => this.staleChangeSource(change),
      )
      if (changes.length > 0 && orderedChanges.length === 0) return false
      this.callback(orderedChanges)
      return true
    }

    if (
      this.orderedWindow &&
      this.hasActiveOrderedDemand() &&
      !this.isBufferingForTruncate &&
      !this.stalePublication
    ) {
      this.orderedWindow.admitChanges(changes)
      const orderedChanges = this.reconcileOrderedWindow()
      if (changes.length > 0 && orderedChanges.length === 0) return false
      this.callback(orderedChanges)
      return true
    }

    // A truncate replacement is private until it has enough ordered evidence
    // to publish. Still admit its source changes so a later continuation uses
    // the exact replacement candidates, including deltas that raced the page.
    if (
      this.orderedWindow &&
      this.hasActiveOrderedDemand() &&
      this.isBufferingForTruncate
    ) {
      this.orderedWindow.admitChanges(changes)
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

    // Reentrant adapter code must be able to release a request by the exact
    // caller predicate even when the subscription predicate was combined into
    // the transport predicate.
    if (opts?.where) this.requestedSubsetWhere.set(loadOptions, opts.where)
    const { demand, result: syncResult } = this.startSubsetDemand(loadOptions)
    if (this.ignoreObsoleteSubsetResult(demand, syncResult)) {
      // The adapter synchronously released or the caller had already aborted
      // this demand. Observe only to consume a possible rejection; obsolete
      // work cannot report status, establish readiness, or publish a scan.
      return false
    }
    demand.onLoadSubsetResult = opts?.onLoadSubsetResult

    // Pass the raw loadSubset result to the caller for external tracking
    opts?.onLoadSubsetResult?.(syncResult, demand.options)
    if (this.ignoreObsoleteSubsetResult(demand, syncResult)) return false

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

    if (
      this.orderedWindow &&
      !this.isBufferingForTruncate &&
      this.stalePublication?.ordered
    ) {
      this.snapshotSent = true
      // A local snapshot can expose a row for this sibling demand, but it
      // cannot prove that a row left behind by a rejected replay belongs in
      // the ordered prefix.
      const changes = this.reconcileStaleOrderedPublication(
        snapshot,
        `additional-demand`,
      )
      if (changes.length > 0) this.callback(changes)
      return true
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
  releaseSnapshot(
    where: BasicExpression<boolean>,
    acquisitionSignal?: AbortSignal,
  ): void {
    const matchesWhere = (demand: SubsetDemand) =>
      demand.requestOptions.where === where ||
      this.requestedSubsetWhere.get(demand.requestOptions) === where
    const matchesAcquisition = (demand: SubsetDemand) =>
      acquisitionSignal === undefined ||
      demand.requestOptions.signal === acquisitionSignal ||
      demand.options.signal === acquisitionSignal ||
      [...demand.pendingReplayAcquisitions].some(
        (pending) => pending.options.signal === acquisitionSignal,
      )
    let demand =
      acquisitionSignal === undefined
        ? this.subsetDemands.find(
            (candidate) => candidate.active && matchesWhere(candidate),
          )
        : this.subsetDemands.find(
            (candidate) =>
              matchesWhere(candidate) && matchesAcquisition(candidate),
          )
    if (!demand && acquisitionSignal === undefined) {
      // A prior unload may have failed after logical release. With no active
      // owner left, a repeated release retries that exact cleanup debt.
      demand = this.subsetDemands.find(matchesWhere)
    }
    if (!demand) return

    demand.active = false
    if (demand.ordered !== undefined) this.retireUnownedOrderedPublication()
    let releaseError: unknown
    try {
      this.releaseSubsetDemand(demand)
    } catch (error) {
      releaseError = error
    } finally {
      this.collectReleasedDemand(demand)
      if (this.orderedWindow && !this.isBufferingForTruncate) {
        const changes = this.stalePublication?.ordered
          ? this.reconcileStaleOrderedPublication([])
          : this.reconcileOrderedWindow()
        if (changes.length > 0) this.callback(changes)
      }
    }
    if (releaseError !== undefined) throw releaseError
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
    if (this.unsubscribed) return
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

    if (this.stalePublication && !this.stalePublication.ordered) {
      // A failed replay may leave rows that are still owned only by active
      // unordered demands. A later ordered incarnation starts with no ordered
      // candidates, but it must still route ingress through top-K admission
      // while preserving that additional publication baseline.
      this.stalePublication.ordered = {
        prefixSize: 0,
        boundary: undefined,
        candidateRows: new Map(),
      }
    }

    const where = this.options.whereExpression
    const retainedPublication = this.retainedOrderedPublication
    const activeReplacement = this.truncateReplaySession !== undefined
    const replayOwnsContinuation =
      activeReplacement || retainedPublication !== undefined
    const refreshPrefix =
      !retainedPublication && this.orderedWindow.requiresPrefixRefresh
    // An active replacement continues its private source progress so it can
    // prove a new publication. A failed replay instead continues from the last
    // complete public prefix until a later replay replaces it.
    const currentOffset = activeReplacement
      ? this.orderedWindow.localPrefixSize
      : retainedPublication
        ? retainedPublication.prefixSize
        : refreshPrefix
          ? 0
          : this.orderedWindow.localPrefixSize
    const requestedPrefix = replayOwnsContinuation
      ? currentOffset + limit
      : refreshPrefix
        ? Math.max(this.orderedWindow.size, limit)
        : offset !== undefined
          ? offset + limit
          : minValues !== undefined
            ? currentOffset + limit
            : limit
    this.orderedWindow.ensureSize(requestedPrefix)
    let requiresUnboundedRefinement = this.orderedWindow.requiresFullRefinement
    const changes =
      !this.isBufferingForTruncate && !this.stalePublication
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

    if (!retainedPublication && this.orderedWindow.coversActiveWindow) {
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

    const boundary = activeReplacement
      ? this.orderedWindow.requestBoundary()
      : retainedPublication
        ? this.orderedBoundary()
        : this.orderedWindow.requestBoundary()
    const cursorValues =
      boundary?.values ?? (replayOwnsContinuation ? undefined : minValues)
    const builtCursor = this.buildOrderedCursorExpressions(
      orderBy,
      cursorValues,
      boundary?.key ??
        (replayOwnsContinuation
          ? undefined
          : this.orderedPublication?.boundary?.key),
    )
    if (builtCursor.requiresUnboundedRefinement) {
      requiresUnboundedRefinement = true
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
            cursor: builtCursor.cursor, // Cursor expressions passed separately
            // Replay continuation is owned by the replacement generation or
            // retained publication, never by stale caller hints.
            offset: replayOwnsContinuation
              ? currentOffset
              : (offset ?? currentOffset),
            subscription: this,
          }

    const {
      demand,
      acquisition,
      result: syncResult,
    } = this.startSubsetDemand(loadOptions, {
      requestedPrefix,
      hadBoundary: boundary !== undefined || refreshPrefix,
      requiresUnboundedRefinement,
      revision: this.orderedWindow.coverageRevision,
    })
    if (this.ignoreObsoleteSubsetResult(demand, syncResult)) {
      // Match unordered acquisition semantics: work released during adapter
      // entry cannot report a result, affect readiness, or establish coverage.
      return
    }
    demand.onLoadSubsetResult = onLoadSubsetResult

    this.observeOrderedCoverage(syncResult, demand, acquisition)
    // Pass the raw loadSubset result to the caller for external tracking
    onLoadSubsetResult?.(syncResult, demand.options)
    if (this.ignoreObsoleteSubsetResult(demand, syncResult)) return
    this.observeLoadSubsetResult(
      syncResult,
      demand.options,
      shouldTrackLoadSubsetPromise,
    )
  }

  private observeOrderedCoverage(
    result: LoadSubsetRequestResult,
    demand: SubsetDemand,
    acquisition: SubsetAcquisition,
    shouldApply: () => boolean = () => true,
  ): void {
    const ordered = acquisition.ordered
    const window = this.orderedWindow
    if (!ordered || !window) return

    const mayApply = () =>
      shouldApply() &&
      this.isActiveDemand(demand) &&
      !acquisition.options.signal?.aborted

    const apply = (outcome?: AppliedLoadSubsetOutcome) => {
      if (!mayApply()) return

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

      if (this.isBufferingForTruncate || this.stalePublication) {
        const session = this.truncateReplaySession
        if (session) this.checkTruncateReplayComplete(session)
        return
      }
      const changes = this.reconcileOrderedWindow()
      if (changes.length > 0) this.callback(changes)
    }

    if (result instanceof Promise) {
      void result.then(apply, () => {})
    } else {
      if (!mayApply()) return
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
          acquisition.options,
        )
        if (retainedOutcome) {
          apply(retainedOutcome)
          return
        }
        window.recordLocalRequestSatisfaction(ordered.requestedPrefix)
      }
      if (this.isBufferingForTruncate || this.stalePublication) {
        const session = this.truncateReplaySession
        if (session) this.checkTruncateReplayComplete(session)
        return
      }
      const changes = this.reconcileOrderedWindow()
      if (changes.length > 0) this.callback(changes)
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
    const staleRows = this.stalePublication?.publishedRows
    if (!staleRows) return changes
    if (staleRows.size === 0) {
      this.stalePublication = undefined
      return changes
    }

    const reconciled: Array<ChangeMessage<any, any>> = []
    for (const change of changes) {
      const previous = staleRows.get(change.key)
      if (previous === undefined) {
        reconciled.push(change)
        continue
      }

      staleRows.delete(change.key)
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
    if (staleRows.size === 0) this.stalePublication = undefined
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
    // Teardown is a permanent acquisition boundary. Adapter cleanup and
    // unsubscribe listeners may reenter public methods, but they cannot create
    // work that escapes the cleanup pass already in progress.
    this.unsubscribed = true
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
    this.stalePublication = undefined
    this.orderedPublication = undefined

    // Release the current adapter acquisition for each logical subset demand.
    for (const demand of [...this.subsetDemands]) {
      demand.active = false
      try {
        this.releaseSubsetDemand(demand)
      } catch (error) {
        firstCleanupError ??= error
      }
    }
    this.subsetDemands = this.subsetDemands.filter(
      (demand) =>
        !demand.releaseSettled || demand.pendingReplayAcquisitions.size > 0,
    )

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
