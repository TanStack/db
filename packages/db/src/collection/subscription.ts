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

type ReplayHandoffResult =
  | { installed: true; failures?: ReadonlyArray<SubsetFailureOccurrence> }
  | { installed: false; failures?: ReadonlyArray<SubsetFailureOccurrence> }

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
  pendingCallbacks: number
  failed: boolean
  setupComplete: boolean
}

type TruncateReplaySession = {
  publicationState: PublicationState
  buffer: Array<Array<ChangeMessage<any, any>>>
  attempts: Set<TruncateReplayAttempt>
  currentAttempt: TruncateReplayAttempt
  errors: Array<SubsetFailureOccurrence>
}

type TruncateReplayContext = Readonly<{
  session: TruncateReplaySession
  attempt: TruncateReplayAttempt
}>

type SubsetFailureOccurrence = {
  readonly error: unknown
  readonly options: LoadSubsetOptions
  readonly order: number
  attributed: boolean
  reported: boolean
}

type SubsetFailureGroup = Readonly<{
  propagatedError: unknown
  failures: ReadonlyArray<SubsetFailureOccurrence>
}>

type ReplayResultCallbackFrame = {
  replayContext: TruncateReplayContext
  options: LoadSubsetOptions
  previous: ReplayResultCallbackFrame | undefined
  failureGroups: Array<SubsetFailureGroup>
}

type SubsetCleanupBoundaryFrame = {
  options: LoadSubsetOptions
  previous: SubsetCleanupBoundaryFrame | undefined
  failureGroups: Array<SubsetFailureGroup>
}

type SubsetAcquisitionFrame = Readonly<{
  options: LoadSubsetOptions
  previous: SubsetAcquisitionFrame | undefined
  failureGroups: Array<SubsetFailureGroup>
}>

type SubsetAcquisitionEntryResult<T> =
  | Readonly<{ completed: true; value: T }>
  | Readonly<{
      completed: false
      error: unknown
      publicError: unknown
      propagated: boolean
      retainedFailures: ReadonlyArray<SubsetFailureOccurrence>
      directFailure?: SubsetFailureOccurrence
    }>

type SubsetCleanupCaptureResult = Readonly<{
  completed: boolean
  failures?: ReadonlyArray<SubsetFailureOccurrence>
}>

class SubsetCleanupAggregateError extends AggregateError {
  constructor(errors: ReadonlyArray<unknown>) {
    super(errors, `Several subset acquisition releases failed`)
  }
}

/** Internal carrier that distinguishes propagation from an equal new throw. */
class SubsetFailurePropagation extends Error {
  constructor(
    readonly payload: unknown,
    private readonly adoptingOptions: ReadonlySet<LoadSubsetOptions>,
  ) {
    super(
      payload instanceof Error
        ? payload.message
        : `A nested subset operation failed`,
    )
    this.name = `SubsetFailurePropagation`
  }

  isAdoptedBy(options: LoadSubsetOptions): boolean {
    return this.adoptingOptions.has(options)
  }
}

function createSubsetCleanupError(errors: ReadonlyArray<unknown>): unknown {
  if (errors.length === 1) return errors[0]
  return new SubsetCleanupAggregateError(errors)
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
  private _lastErrorVersion = 0
  private unsubscribed = false
  private terminalEventDispatched = false
  private pendingLoadSubsetPromises: Set<Promise<unknown>> = new Set()
  // Cleanup function for truncate event listener
  private truncateCleanup: (() => void) | undefined

  // One replay session owns the publication baseline, overlapping attempts,
  // and buffered changes until every attempt settles.
  private truncateReplaySession: TruncateReplaySession | undefined
  // Adapter boundaries identify failure occurrences while arbitrary replay
  // callbacks run. Payload identity alone cannot distinguish two operations
  // that throw the same Error object.
  private activeReplayResultCallback: ReplayResultCallbackFrame | undefined
  private activeSubsetCleanupBoundary: SubsetCleanupBoundaryFrame | undefined
  private activeSubsetAcquisition: SubsetAcquisitionFrame | undefined
  private nextSubsetFailureOrder = 0
  private replayErrorReportDepth = 0
  private clearListenersAfterReplayErrors = false
  private unsubscribeInProgress = false
  private replayTeardownPending = false
  private replayTeardownFinalizationScheduled = false

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

  public get lastErrorVersion(): number {
    return this._lastErrorVersion
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
      pendingCallbacks: 0,
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
        errors: [],
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

      for (const demand of demandsToReload) {
        if (!this.isActiveDemand(demand)) continue

        const isCurrentAttempt = () =>
          this.truncateReplaySession === session &&
          session.currentAttempt === attempt
        const nextAcquisition = this.createSubsetAcquisition(demand, true)
        demand.pendingReplayAcquisitions.add(nextAcquisition)
        const replayContext = { session, attempt }
        const entry = this.enterSubsetAcquisition(
          nextAcquisition.options,
          replayContext,
          () => this.collection._sync.loadSubset(nextAcquisition.options),
        )
        if (!entry.completed) {
          const shouldReportError =
            isCurrentAttempt() &&
            (!nextAcquisition.options.signal?.aborted ||
              this.replayTeardownPending)
          demand.pendingReplayAcquisitions.delete(nextAcquisition)
          nextAcquisition.abortController.abort()
          nextAcquisition.removeRequestAbortListener?.()
          attempt.failed = true
          if (shouldReportError) {
            if (entry.propagated) {
              this.queueUnattributedReplayFailures(
                session,
                entry.retainedFailures,
              )
            } else if (entry.directFailure) {
              this.queueTruncateReplayError(
                session,
                nextAcquisition.options,
                entry.publicError,
                entry.directFailure,
              )
            }
          }
          continue
        }
        const syncResult = entry.value

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
            (error: unknown) => {
              const adoptedPropagation =
                error instanceof SubsetFailurePropagation &&
                error.isAdoptedBy(nextAcquisition.options)
              const failedCurrentDemand =
                (this.isActiveDemand(demand) &&
                  !nextAcquisition.options.signal?.aborted) ||
                (this.replayTeardownPending && isCurrentAttempt())
              // A released demand no longer participates in the current
              // replacement. Its cooperative AbortError must not discard the
              // successful rows from demands that are still active.
              if (failedCurrentDemand) {
                attempt.failed = true
                if (!adoptedPropagation) {
                  this.queueTruncateReplayError(
                    session,
                    nextAcquisition.options,
                    this.publicSubsetFailure(error),
                  )
                }
              }
              const cleanupFailures = this.discardReplayAcquisition(
                demand,
                nextAcquisition,
              )
              if (cleanupFailures) {
                this.queueUnattributedReplayFailures(session, cleanupFailures)
              }
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
          () => false,
        )
        // Preserve the original demand's consumer-local in-flight guard. This
        // observer is registered last so its settlement sees replay ownership,
        // coverage, and attempt bookkeeping before it may continue the window.
        this.invokeReplayResultCallback(
          { session, attempt },
          nextAcquisition.options,
          () =>
            demand.onLoadSubsetResult?.(syncResult, nextAcquisition.options),
        )
      }

      attempt.setupComplete = true
      this.checkTruncateReplayComplete(session)
    })
  }

  private queueTruncateReplayError(
    session: TruncateReplaySession,
    options: LoadSubsetOptions,
    error: unknown,
    occurrence?: SubsetFailureOccurrence,
  ): void {
    if (this.truncateReplaySession !== session) return
    const failure =
      occurrence ?? this.createSubsetFailureOccurrence(options, error)
    if (failure.reported || session.errors.includes(failure)) return
    failure.attributed = true
    session.errors.push(failure)
  }

  private queueUnattributedReplayFailures(
    session: TruncateReplaySession,
    failures: ReadonlyArray<SubsetFailureOccurrence>,
  ): void {
    if (this.truncateReplaySession !== session) return
    for (const failure of failures) {
      if (!failure.attributed) {
        this.queueTruncateReplayError(
          session,
          failure.options,
          failure.error,
          failure,
        )
      }
    }
  }

  private createSubsetFailureOccurrence(
    options: LoadSubsetOptions,
    error: unknown,
  ): SubsetFailureOccurrence {
    return {
      error,
      options,
      order: this.nextSubsetFailureOrder++,
      attributed: false,
      reported: false,
    }
  }

  /** Record which adapter failure occurrences propagate through one frame. */
  private noteSubsetFailureGroup(
    replayContext: TruncateReplayContext | undefined,
    group: SubsetFailureGroup,
  ): void {
    this.activeSubsetCleanupBoundary?.failureGroups.push(group)
    this.activeSubsetAcquisition?.failureGroups.push(group)
    const frame = this.activeReplayResultCallback
    if (
      !frame ||
      (replayContext && frame.replayContext.session !== replayContext.session)
    ) {
      return
    }
    frame.failureGroups.push(group)
  }

  private subsetFailureBoundaryOptions(): LoadSubsetOptions | undefined {
    if (this.activeSubsetCleanupBoundary) {
      return this.activeSubsetCleanupBoundary.options
    }
    const callbackFrame = this.activeReplayResultCallback
    return callbackFrame &&
      this.truncateReplaySession === callbackFrame.replayContext.session
      ? callbackFrame.options
      : undefined
  }

  /** Tokenize nested propagation without changing the reported payload. */
  private propagatedSubsetFailure(
    error: unknown,
    {
      excludeCurrentAcquisition = false,
      callbackBoundaryOnly = false,
    }: {
      excludeCurrentAcquisition?: boolean
      callbackBoundaryOnly?: boolean
    } = {},
  ): unknown {
    const adoptingOptions = new Set<LoadSubsetOptions>()
    let frame = excludeCurrentAcquisition
      ? this.activeSubsetAcquisition?.previous
      : this.activeSubsetAcquisition
    while (frame) {
      adoptingOptions.add(frame.options)
      frame = frame.previous
    }
    if (
      !this.subsetFailureBoundaryOptions() &&
      (callbackBoundaryOnly || adoptingOptions.size === 0)
    ) {
      return error
    }
    return new SubsetFailurePropagation(error, adoptingOptions)
  }

  private publicSubsetFailure(error: unknown): unknown {
    return error instanceof SubsetFailurePropagation ? error.payload : error
  }

  /** Run one adapter entry with the same causal frame on every start path. */
  private enterSubsetAcquisition<T>(
    options: LoadSubsetOptions,
    replayContext: TruncateReplayContext | undefined,
    enter: () => T,
  ): SubsetAcquisitionEntryResult<T> {
    const frame: SubsetAcquisitionFrame = {
      options,
      previous: this.activeSubsetAcquisition,
      failureGroups: [],
    }
    this.activeSubsetAcquisition = frame
    try {
      const value = enter()
      if (
        replayContext &&
        this.truncateReplaySession === replayContext.session
      ) {
        const retainedFailures = frame.failureGroups.flatMap((group) =>
          group.failures.filter((failure) => !failure.attributed),
        )
        if (retainedFailures.length > 0) {
          replayContext.attempt.failed = true
          this.queueUnattributedReplayFailures(
            replayContext.session,
            retainedFailures,
          )
        }
      }
      return { completed: true, value }
    } catch (error) {
      const adoptedCarrier =
        error instanceof SubsetFailurePropagation && error.isAdoptedBy(options)
      const retainedFailures = frame.failureGroups.flatMap((group) =>
        Object.is(group.propagatedError, error) ? group.failures : [],
      )
      const propagated = adoptedCarrier || retainedFailures.length > 0
      const publicError = this.publicSubsetFailure(error)
      let propagatedError = error
      let directFailure: SubsetFailureOccurrence | undefined

      if (!options.signal?.aborted || this.replayTeardownPending) {
        if (retainedFailures.length > 0) {
          propagatedError = this.propagatedSubsetFailure(publicError, {
            excludeCurrentAcquisition: true,
          })
          if (!Object.is(propagatedError, error)) {
            this.noteSubsetFailureGroup(replayContext, {
              propagatedError,
              failures: retainedFailures,
            })
          }
        } else if (!propagated) {
          propagatedError = this.propagatedSubsetFailure(publicError, {
            excludeCurrentAcquisition: true,
          })
          directFailure = this.createSubsetFailureOccurrence(
            options,
            publicError,
          )
          this.noteSubsetFailureGroup(replayContext, {
            propagatedError,
            failures: [directFailure],
          })
        }
      }

      const escapesOrdinaryOutermostStart =
        propagated &&
        frame.previous === undefined &&
        !this.subsetFailureBoundaryOptions()
      return {
        completed: false,
        error: escapesOrdinaryOutermostStart ? publicError : propagatedError,
        publicError,
        propagated,
        retainedFailures,
        directFailure,
      }
    } finally {
      this.activeSubsetAcquisition = frame.previous
    }
  }

  /** Preserve nested cleanup provenance across one arbitrary adapter callback. */
  private captureSubsetCleanupFailures(
    options: LoadSubsetOptions,
    callback: () => void,
  ): SubsetCleanupCaptureResult {
    const frame: SubsetCleanupBoundaryFrame = {
      options,
      previous: this.activeSubsetCleanupBoundary,
      failureGroups: [],
    }
    this.activeSubsetCleanupBoundary = frame
    let caught = false
    let caughtError: unknown
    try {
      callback()
    } catch (error) {
      caught = true
      caughtError = error
    } finally {
      this.activeSubsetCleanupBoundary = frame.previous
    }

    const failures = frame.failureGroups.flatMap((group) => group.failures)
    const propagatedNestedFailure =
      caught &&
      frame.failureGroups.some((group) =>
        Object.is(group.propagatedError, caughtError),
      )
    if (caught && !propagatedNestedFailure) {
      failures.push(
        this.createSubsetFailureOccurrence(
          options,
          this.publicSubsetFailure(caughtError),
        ),
      )
    }
    return {
      completed: !caught,
      ...(failures.length > 0 && { failures }),
    }
  }

  /** Attribute one replay callback failure without merging equal payloads. */
  private invokeReplayResultCallback(
    replayContext: TruncateReplayContext | undefined,
    options: LoadSubsetOptions,
    callback: () => void,
  ): void {
    if (
      !replayContext ||
      this.truncateReplaySession !== replayContext.session
    ) {
      try {
        callback()
      } catch (error) {
        throw this.publicSubsetFailure(error)
      }
      return
    }

    const frame: ReplayResultCallbackFrame = {
      replayContext,
      options,
      previous: this.activeReplayResultCallback,
      failureGroups: [],
    }
    this.activeReplayResultCallback = frame
    let caught = false
    let caughtError: unknown
    try {
      callback()
    } catch (error) {
      caught = true
      caughtError = error
    } finally {
      this.activeReplayResultCallback = frame.previous
    }

    if (this.truncateReplaySession !== replayContext.session) {
      if (caught) {
        throw this.publicSubsetFailure(caughtError)
      }
      return
    }

    if (
      frame.previous?.replayContext.session === replayContext.session &&
      frame.failureGroups.length > 0
    ) {
      frame.previous.failureGroups.push(...frame.failureGroups)
    }

    const seen = new Set<SubsetFailureOccurrence>()
    const nestedFailures: Array<SubsetFailureOccurrence> = []
    for (const group of frame.failureGroups) {
      for (const failure of group.failures) {
        if (!failure.attributed && !seen.has(failure)) {
          seen.add(failure)
          nestedFailures.push(failure)
        }
      }
    }
    const propagated =
      caught &&
      frame.failureGroups.some((group) =>
        Object.is(group.propagatedError, caughtError),
      )
    const hasCallbackFailure = caught && !propagated
    if (nestedFailures.length === 0 && !hasCallbackFailure) return

    replayContext.attempt.failed = true
    for (const failure of nestedFailures) {
      this.queueTruncateReplayError(
        replayContext.session,
        failure.options,
        failure.error,
        failure,
      )
    }
    if (hasCallbackFailure) {
      this.queueTruncateReplayError(
        replayContext.session,
        options,
        this.publicSubsetFailure(caughtError),
      )
    }
    this.checkTruncateReplayComplete(replayContext.session)
  }

  private reportSubsetFailureOccurrence(
    failure: SubsetFailureOccurrence,
  ): void {
    if (failure.reported) return
    // Mark first because an error listener may reenter teardown while the
    // public event is being dispatched.
    failure.attributed = true
    failure.reported = true
    this.recordLoadSubsetError(failure.options, failure.error, true)
  }

  private reportTruncateReplayErrors(session: TruncateReplaySession): void {
    this.replayErrorReportDepth++
    try {
      session.errors.sort((left, right) => left.order - right.order)
      while (session.errors.length > 0) {
        this.reportSubsetFailureOccurrence(session.errors.shift()!)
      }
    } finally {
      this.replayErrorReportDepth--
      if (
        this.replayErrorReportDepth === 0 &&
        this.clearListenersAfterReplayErrors
      ) {
        this.clearListenersAfterReplayErrors = false
        this.clearListeners()
      }
    }
  }

  /** Report every retained failure before teardown discards its replay session. */
  private reportReplayFailuresBeforeTeardown(): void {
    const session = this.truncateReplaySession
    if (!session) return

    const frames: Array<ReplayResultCallbackFrame> = []
    let frame = this.activeReplayResultCallback
    while (frame?.replayContext.session === session) {
      frames.push(frame)
      frame = frame.previous
    }

    const seen = new Set<SubsetFailureOccurrence>()
    const failures: Array<SubsetFailureOccurrence> = []
    for (const failure of session.errors.splice(0)) {
      if (seen.has(failure)) continue
      seen.add(failure)
      failures.push(failure)
    }
    for (const callbackFrame of frames.reverse()) {
      for (const group of callbackFrame.failureGroups) {
        for (const failure of group.failures) {
          if (failure.reported || seen.has(failure)) continue
          seen.add(failure)
          failures.push(failure)
        }
      }
    }
    failures.sort((left, right) => left.order - right.order)
    for (const failure of failures) {
      this.reportSubsetFailureOccurrence(failure)
    }
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
      if (
        !attempt.setupComplete ||
        attempt.pending.size > 0 ||
        attempt.pendingCallbacks > 0
      ) {
        return
      }
    }

    if (session.currentAttempt.failed) {
      this.abandonTruncateReplay(session)
      this.reportTruncateReplayErrors(session)
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
    this.reportTruncateReplayErrors(session)
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
      const adoptedPropagation =
        error instanceof SubsetFailurePropagation && error.isAdoptedBy(options)
      if (!adoptedPropagation && shouldReportError()) {
        this.recordLoadSubsetError(
          options,
          this.publicSubsetFailure(error),
          reportAborted,
        )
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
  ): ReplayHandoffResult {
    if (demand.releaseInProgress) return { installed: false }
    demand.releaseInProgress = true
    const previousOptions = demand.options
    const removePreviousAbortListener = demand.removeRequestAbortListener
    const failures: Array<SubsetFailureOccurrence> = []
    try {
      const previousCleanup = this.captureSubsetCleanupFailures(
        previousOptions,
        () => {
          this.collection._sync.unloadSubset(previousOptions)
        },
      )
      if (previousCleanup.failures) failures.push(...previousCleanup.failures)
      if (!previousCleanup.completed) {
        return {
          installed: false,
          ...(failures.length > 0 && { failures }),
        }
      }
      removePreviousAbortListener?.()
      demand.releaseFailed = false
      demand.releaseSettled = true

      // unloadSubset is user adapter code and may synchronously release the
      // logical demand. In that case the replacement must never become its
      // new live acquisition.
      if (!this.isActiveDemand(demand)) {
        const replacementCleanup = this.captureSubsetCleanupFailures(
          next.options,
          () => this.releaseReplayAcquisitionUnprotected(demand, next),
        )
        if (replacementCleanup.failures) {
          failures.push(...replacementCleanup.failures)
        }
        return {
          installed: false,
          ...(failures.length > 0 && { failures }),
        }
      }

      demand.options = next.options
      demand.ordered = next.ordered
      demand.abortController = next.abortController
      demand.removeRequestAbortListener = next.removeRequestAbortListener
      demand.releaseSettled = false
      return {
        installed: true,
        ...(failures.length > 0 && { failures }),
      }
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
      return this.tryReplaceSubsetAcquisition(session, demand, next, attempt)
    }
    const cleanupFailures = this.discardReplayAcquisition(demand, next)
    if (cleanupFailures) {
      this.queueUnattributedReplayFailures(session, cleanupFailures)
    }
    return false
  }

  private tryReplaceSubsetAcquisition(
    session: TruncateReplaySession,
    demand: SubsetDemand,
    next: ReplaySubsetAcquisition,
    attempt: TruncateReplayAttempt,
  ): boolean {
    const handoff = this.replaceSubsetAcquisition(demand, next)
    if (handoff.failures) {
      attempt.failed = true
      this.queueUnattributedReplayFailures(session, handoff.failures)
    }
    if (handoff.installed) {
      demand.pendingReplayAcquisitions.delete(next)
      return true
    }
    if (handoff.failures) {
      // The old lease remains owned when its release fails. Release the new
      // acquisition and preserve every failed cleanup as a distinct event.
      const discardFailures = this.discardReplayAcquisition(demand, next)
      if (discardFailures) {
        this.queueUnattributedReplayFailures(session, discardFailures)
      }
    }
    return false
  }

  private discardReplayAcquisition(
    demand: SubsetDemand,
    next: ReplaySubsetAcquisition,
  ): ReadonlyArray<SubsetFailureOccurrence> | undefined {
    // A failed acquisition stays on the demand. releaseSnapshot, unsubscribe,
    // or collection cleanup will retry its exact owner route.
    return this.captureSubsetCleanupFailures(next.options, () =>
      this.releaseReplayAcquisition(demand, next),
    ).failures
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
      const releaseFailures: Array<SubsetFailureOccurrence> = []
      for (const pending of [...demand.pendingReplayAcquisitions]) {
        const cleanup = this.captureSubsetCleanupFailures(pending.options, () =>
          this.releaseReplayAcquisitionUnprotected(demand, pending),
        )
        if (cleanup.failures) releaseFailures.push(...cleanup.failures)
      }
      if (!demand.releaseSettled) {
        try {
          const cleanup = this.captureSubsetCleanupFailures(
            demand.options,
            () => {
              this.collection._sync.unloadSubset(demand.options)
              demand.releaseFailed = false
              demand.releaseSettled = true
            },
          )
          if (!cleanup.completed) demand.releaseFailed = true
          if (cleanup.failures) releaseFailures.push(...cleanup.failures)
        } finally {
          demand.removeRequestAbortListener?.()
        }
      }
      if (releaseFailures.length > 0) {
        const cleanupError = createSubsetCleanupError(
          releaseFailures.map(({ error: failure }) => failure),
        )
        const propagatedError = this.propagatedSubsetFailure(cleanupError, {
          callbackBoundaryOnly: true,
        })
        this.noteSubsetFailureGroup(undefined, {
          propagatedError,
          failures: releaseFailures,
        })
        throw propagatedError
      }
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
    replayContext: TruncateReplayContext | undefined
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
    const replaySession = this.truncateReplaySession
    const replayContext = replaySession
      ? { session: replaySession, attempt: replaySession.currentAttempt }
      : undefined
    if (acquisition.abortController.signal.aborted) {
      acquisition.removeRequestAbortListener?.()
      return { demand, acquisition, result: true, replayContext }
    }
    // Reentrant release must see the exact acquisition before adapter work
    // starts. A genuine load throw removes this tentative logical owner below.
    this.subsetDemands.push(demand)
    // A synchronous start failure is not observable until the tentative owner
    // has rolled back. Otherwise an error listener can reenter release and
    // unload a request that never established an acquisition.
    const entry = this.enterSubsetAcquisition(
      acquisition.options,
      replayContext,
      () => this.collection._sync.loadSubset(acquisition.options),
    )
    if (entry.completed) {
      return { demand, acquisition, result: entry.value, replayContext }
    }

    const shouldReportError =
      !acquisition.options.signal?.aborted ||
      Boolean(
        this.replayTeardownPending &&
        replayContext &&
        this.truncateReplaySession === replayContext.session,
      )
    const demandIndex = this.subsetDemands.indexOf(demand)
    if (demandIndex !== -1 && !demand.releaseFailed) {
      this.subsetDemands.splice(demandIndex, 1)
      acquisition.abortController.abort()
      acquisition.removeRequestAbortListener?.()
    }
    if (shouldReportError && entry.directFailure) {
      const occurrence = entry.directFailure
      if (
        replayContext &&
        this.truncateReplaySession === replayContext.session
      ) {
        replayContext.attempt.failed = true
        this.queueTruncateReplayError(
          replayContext.session,
          acquisition.options,
          entry.publicError,
          occurrence,
        )
        this.checkTruncateReplayComplete(replayContext.session)
      } else {
        occurrence.attributed = true
        occurrence.reported = true
        this.recordLoadSubsetError(acquisition.options, entry.publicError, true)
      }
    }
    throw entry.error
  }

  /** Keep replay publication private until one result callback returns. */
  private retainReplayResultCallback(
    replayContext: TruncateReplayContext | undefined,
  ): TruncateReplayContext | undefined {
    if (
      !replayContext ||
      this.truncateReplaySession !== replayContext.session
    ) {
      return undefined
    }
    replayContext.attempt.pendingCallbacks++
    return replayContext
  }

  private releaseReplayResultCallback(
    replayContext: TruncateReplayContext | undefined,
  ): void {
    if (!replayContext) return
    replayContext.attempt.pendingCallbacks--
    if (this.truncateReplaySession === replayContext.session) {
      this.checkTruncateReplayComplete(replayContext.session)
    }
  }

  /** Join demand work started by a replay callback to that publication epoch. */
  private trackDemandStartedDuringReplay(
    demand: SubsetDemand,
    result: LoadSubsetRequestResult,
    replayContext: TruncateReplayContext | undefined,
  ): TruncateReplayContext | undefined {
    if (
      !replayContext ||
      this.truncateReplaySession !== replayContext.session
    ) {
      return undefined
    }
    const { session, attempt } = replayContext
    if (!(result instanceof Promise)) return replayContext

    void result.then(
      () => {},
      (error: unknown) => {
        if (
          error instanceof SubsetFailurePropagation &&
          error.isAdoptedBy(demand.options)
        ) {
          // The originating nested boundary already failed this replay and
          // retained its public payload. Promise adoption must not turn the
          // private propagation carrier into a second adapter occurrence.
          return
        }
        if (this.isActiveDemand(demand) && !demand.options.signal?.aborted) {
          attempt.failed = true
          this.queueTruncateReplayError(
            session,
            demand.options,
            this.publicSubsetFailure(error),
          )
        }
      },
    )
    this.trackTruncateReplayResult(session, attempt, result, () => {
      return this.isActiveDemand(demand) && !demand.options.signal?.aborted
    })
    return replayContext
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
    this._lastErrorVersion++
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
    const {
      demand,
      result: syncResult,
      replayContext: startedReplayContext,
    } = this.startSubsetDemand(loadOptions)
    const replayTracksCallback =
      this.retainReplayResultCallback(startedReplayContext)
    // Replay settlement owns the acquisition even if the result callback
    // immediately releases its logical demand. Install the barrier and its
    // status observer before invoking arbitrary callback code.
    const replayTracksResult = this.trackDemandStartedDuringReplay(
      demand,
      syncResult,
      startedReplayContext,
    )
    if (replayTracksResult) {
      this.observeLoadSubsetResult(
        syncResult,
        demand.options,
        opts?.trackLoadSubsetPromise ?? true,
        () => false,
      )
    }
    if (this.ignoreObsoleteSubsetResult(demand, syncResult)) {
      // The adapter synchronously released or the caller had already aborted
      // this demand. Observe only to consume a possible rejection; obsolete
      // work cannot report status, establish readiness, or publish a scan.
      this.releaseReplayResultCallback(replayTracksCallback)
      return false
    }
    demand.onLoadSubsetResult = opts?.onLoadSubsetResult

    // Pass the raw loadSubset result to the caller for external tracking
    try {
      this.invokeReplayResultCallback(replayTracksResult, demand.options, () =>
        opts?.onLoadSubsetResult?.(syncResult, demand.options),
      )
    } finally {
      this.releaseReplayResultCallback(replayTracksCallback)
    }
    if (this.ignoreObsoleteSubsetResult(demand, syncResult)) return false

    if (!replayTracksResult) {
      this.observeLoadSubsetResult(
        syncResult,
        demand.options,
        opts?.trackLoadSubsetPromise ?? true,
      )
    }

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
    let releaseFailure: { error: unknown } | undefined
    try {
      this.releaseSubsetDemand(demand)
    } catch (error) {
      releaseFailure = { error }
    } finally {
      this.collectReleasedDemand(demand)
      if (this.orderedWindow && !this.isBufferingForTruncate) {
        const changes = this.stalePublication?.ordered
          ? this.reconcileStaleOrderedPublication([])
          : this.reconcileOrderedWindow()
        if (changes.length > 0) this.callback(changes)
      }
    }
    if (releaseFailure) throw releaseFailure.error
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
      replayContext: startedReplayContext,
    } = this.startSubsetDemand(loadOptions, {
      requestedPrefix,
      hadBoundary: boundary !== undefined || refreshPrefix,
      requiresUnboundedRefinement,
      revision: this.orderedWindow.coverageRevision,
    })

    // A synchronous continuation can complete ordered coverage. Retain its
    // callback before applying that evidence so callback failure can still
    // restore the originating replay publication.
    const replayTracksCallback =
      this.retainReplayResultCallback(startedReplayContext)

    // Ordered evidence must settle before the replay barrier. The barrier and
    // its status observer in turn precede arbitrary result callbacks, so a
    // callback can retire authority without erasing pending work.
    this.observeOrderedCoverage(syncResult, demand, acquisition)
    const replayTracksResult = this.trackDemandStartedDuringReplay(
      demand,
      syncResult,
      startedReplayContext,
    )
    if (replayTracksResult) {
      this.observeLoadSubsetResult(
        syncResult,
        demand.options,
        shouldTrackLoadSubsetPromise,
        () => false,
      )
    }
    if (this.ignoreObsoleteSubsetResult(demand, syncResult)) {
      // Match unordered acquisition semantics: work released during adapter
      // entry cannot report a result, affect readiness, or establish coverage.
      this.releaseReplayResultCallback(replayTracksCallback)
      return
    }
    demand.onLoadSubsetResult = onLoadSubsetResult

    // Pass the raw loadSubset result to the caller for external tracking
    try {
      this.invokeReplayResultCallback(replayTracksResult, demand.options, () =>
        onLoadSubsetResult?.(syncResult, demand.options),
      )
    } finally {
      this.releaseReplayResultCallback(replayTracksCallback)
    }
    if (this.ignoreObsoleteSubsetResult(demand, syncResult)) return
    if (!replayTracksResult) {
      this.observeLoadSubsetResult(
        syncResult,
        demand.options,
        shouldTrackLoadSubsetPromise,
      )
    }
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
    if (
      this.unsubscribeInProgress ||
      this.clearListenersAfterReplayErrors ||
      this.replayTeardownPending
    ) {
      return
    }
    const deferReplayFinalization = Boolean(
      this.truncateReplaySession && this.hasActiveSubsetAdapterBoundary(),
    )
    if (deferReplayFinalization) this.replayTeardownPending = true
    this.unsubscribeInProgress = true
    try {
      this.unsubscribeOnce(deferReplayFinalization)
    } finally {
      this.unsubscribeInProgress = false
      if (deferReplayFinalization) this.scheduleReplayTeardownFinalization()
    }
  }

  private hasActiveSubsetAdapterBoundary(): boolean {
    return Boolean(
      this.activeSubsetAcquisition ||
      this.activeSubsetCleanupBoundary ||
      this.activeReplayResultCallback,
    )
  }

  /** Publish retained failures before final replay teardown becomes terminal. */
  private scheduleReplayTeardownFinalization(): void {
    if (this.replayTeardownFinalizationScheduled) return
    this.replayTeardownFinalizationScheduled = true
    queueMicrotask(() => {
      // Adapter code may return an already-rejected Promise. Give its observer
      // one turn to retain the failure before the teardown pass runs.
      queueMicrotask(() => {
        this.replayTeardownFinalizationScheduled = false
        if (!this.replayTeardownPending) return
        if (
          this.hasActiveSubsetAdapterBoundary() ||
          this.unsubscribeInProgress ||
          this.clearListenersAfterReplayErrors
        ) {
          this.scheduleReplayTeardownFinalization()
          return
        }
        this.finishReplayTeardown()
      })
    })
  }

  private unsubscribeOnce(deferReplayFinalization = false): void {
    // Teardown is a permanent acquisition boundary. Adapter cleanup and
    // unsubscribe listeners may reenter public methods, but they cannot create
    // work that escapes the cleanup pass already in progress.
    this.unsubscribed = true
    this.reportReplayFailuresBeforeTeardown()
    const boundaryOptions = this.subsetFailureBoundaryOptions()
    const cleanupFailures: Array<{
      error: unknown
      occurrence?: SubsetFailureOccurrence
    }> = []
    const recordCleanupError = (error: unknown) => {
      cleanupFailures.push(
        boundaryOptions
          ? {
              error,
              occurrence: this.createSubsetFailureOccurrence(
                boundaryOptions,
                error,
              ),
            }
          : { error },
      )
    }

    // Clean up truncate event listener
    try {
      this.truncateCleanup?.()
    } catch (error) {
      recordCleanupError(error)
    }
    this.truncateCleanup = undefined

    if (!deferReplayFinalization) {
      // Stop any buffered replay from publishing after unsubscription.
      this.truncateReplaySession = undefined
      this.stalePublication = undefined
      this.orderedPublication = undefined
    }

    // Release the current adapter acquisition for each logical subset demand.
    for (const demand of [...this.subsetDemands]) {
      demand.active = false
      const cleanup = this.captureSubsetCleanupFailures(demand.options, () =>
        this.releaseSubsetDemand(demand),
      )
      if (cleanup.failures) {
        cleanupFailures.push(
          ...cleanup.failures.map((occurrence) => ({
            error: occurrence.error,
            occurrence,
          })),
        )
      }
    }
    this.subsetDemands = this.subsetDemands.filter(
      (demand) =>
        !demand.releaseSettled || demand.pendingReplayAcquisitions.size > 0,
    )

    if (!deferReplayFinalization) {
      for (const error of this.finishTerminalTeardown()) {
        recordCleanupError(error)
      }
    }

    if (cleanupFailures.length > 0) {
      const cleanupError = createSubsetCleanupError(
        cleanupFailures.map(({ error }) => error),
      )
      const propagatedError = this.propagatedSubsetFailure(cleanupError, {
        callbackBoundaryOnly: true,
      })
      if (!Object.is(propagatedError, cleanupError)) {
        const occurrences = cleanupFailures.flatMap(({ occurrence }) =>
          occurrence ? [occurrence] : [],
        )
        if (occurrences.length !== cleanupFailures.length) throw cleanupError
        this.noteSubsetFailureGroup(undefined, {
          propagatedError,
          failures: occurrences,
        })
        throw propagatedError
      }
      throw cleanupError
    }
  }

  private finishReplayTeardown(): void {
    this.reportReplayFailuresBeforeTeardown()
    this.truncateReplaySession = undefined
    this.stalePublication = undefined
    this.orderedPublication = undefined
    const listenerErrors = this.finishTerminalTeardown()
    this.replayTeardownPending = false
    if (listenerErrors.length === 0) return

    const terminalError = createSubsetCleanupError(listenerErrors)
    // The reentrant unsubscribe call has already returned. Preserve terminal
    // listener failures through the ordinary asynchronous event-error channel.
    queueMicrotask(() => {
      throw terminalError
    })
  }

  private finishTerminalTeardown(): ReadonlyArray<unknown> {
    const listenerErrors: Array<unknown> = []
    try {
      if (!this.terminalEventDispatched) {
        // Cleanup debt may require later unsubscribe passes, but terminal
        // publication is one lifecycle edge for the subscription.
        this.terminalEventDispatched = true
        listenerErrors.push(
          ...this.emitInnerCollectErrors(`unsubscribed`, {
            type: `unsubscribed`,
            subscription: this,
          }),
        )
      }
    } finally {
      // Clear all event listeners to prevent memory leaks
      if (this.replayErrorReportDepth > 0) {
        // Retained replay failures form one ordered report batch. Reentrant
        // teardown may release ownership now, but it cannot erase later
        // occurrences that were already retained before the first dispatch.
        this.clearListenersAfterReplayErrors = true
      } else {
        this.clearListeners()
      }
    }
    return listenerErrors
  }
}
