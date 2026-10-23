import {
  buildCursorCurrent,
  canExpressCursorOrder,
} from '../../utils/cursor.js'
import { normalizeError } from '../../utils/error.js'
import { reportUncaught, runAllCallbacks } from '../../utils/callbacks.js'
import { normalizeOrderByPaths } from '../compiler/expressions.js'
import type {
  CollectionSubscription,
  ReleaseLoadSubset,
} from '../../collection/subscription.js'
import type {
  ChangeMessage,
  LoadSubsetOptions,
  LoadSubsetRequestResult,
} from '../../types.js'
import type { OrderByOptimizationInfo } from '../compiler/order-by.js'

type OrderedRequestKind =
  `ordered` | `ordered-repair` | `boundary` | `full-source`

// What a request or its continuation carries from issue: the ordered-load
// generation (cursor resets), the authority generation (authoritative
// starts), the ordering generation (invalidations), and the request's role.
// `standing()` and `supersedes()` are the only comparisons.
type RequestStamp = {
  orderedLoadGeneration: number
  authorityGeneration: number
  orderingInvalidationGeneration: number
  role: `finite` | `repair` | `full-source`
}

type OrderedContinuation = RequestStamp & {
  kind: `boundary` | `more`
  windowOperationGeneration?: number
  continuesOrderedPrefixRepair: boolean
}

// The authoritative work the loader holds. A bounded repair runs as a chain
// (prefix, tie, refill) fenced by the ordering epoch it started in. A
// full-source read is held while in flight or awaiting replay, complete once
// it covers the source, and failed until a retry.
type AuthoritativeWork =
  | { kind: `idle` }
  | { kind: `repair`; epoch: number }
  | { kind: `full-source`; status: `held` | `complete` | `failed` }

// The repair the loader owes. An ordering invalidation after settled work
// owes a bounded repair; partial writes or an unexpressible boundary owe a
// full-source read.
type RepairDebt = `none` | `bounded` | `full`

type WorkState = `idle` | `repair` | `held` | `complete` | `failed`

const workState = (work: AuthoritativeWork): WorkState =>
  work.kind === `full-source` ? work.status : work.kind

/** The loader's work slot or debt reached a state its rules forbid. */
export class OrderedLoaderInvariantError extends Error {}

// A release that throws is an adapter bug and is reported uncaught. An
// invariant violation raised by code that the release reentered still fails.
function reportReleaseError(error: unknown): void {
  if (error instanceof OrderedLoaderInvariantError) throw error
  reportUncaught(error)
}

class OrderedPostSettlementError {
  constructor(readonly cause: unknown) {}
}

/** Owns the conservative provider-loading policy for one ordered source. */
export class OrderedSourceLoader {
  private pending: Promise<void> | undefined
  // Exact request settlement is not provider extent. This latch only records
  // that some request once completed; reset may discard the boundary, and an
  // empty page retains it. A failure never reads it before a full-source
  // completion sets it again, so it never needs clearing.
  private hasSettledSourceRequest = false
  private settledSourceBoundary: Record<string, unknown> | undefined
  // Independent of ordinary finite success. A live delete or order-changing
  // update owes a bounded repair: unlike a failed request it cannot have
  // partially written unknown rows, so re-reading the exact ordered prefix is
  // authoritative for the current window and preserves the provider query
  // shape.
  private debt: RepairDebt = `none`
  private requesting = false
  // Retaining a demand does not prove it succeeded. Async failure retains it
  // (`failed`) for replay; a synchronous startup failure retains nothing.
  private work: AuthoritativeWork = { kind: `idle` }
  // Keep callbacks, not copied requests or rows. Successful full-source work
  // subsumes these logical owners; unfinished transports remain observed.
  // Each records its prefix count, for a repair's own acquisitions the epoch
  // of the repair chain it belongs to, and for a tie request its boundary row.
  private settledFiniteAcquisitions = new Map<
    ReleaseLoadSubset,
    {
      count: number | undefined
      chain: number | undefined
      tie: Record<string, unknown> | undefined
    }
  >()
  // The record's presence blocks automatic retry, including initial requests
  // that have no explicit window-operation generation.
  private failedRequest:
    { windowOperationGeneration: number | undefined } | undefined
  // A superseded failure owes only a full-source read, so that read's success
  // retires it without an explicit retry.
  private failedAcquisitions = new Map<
    ReleaseLoadSubset,
    { kind: OrderedRequestKind; superseded: boolean }
  >()
  private active = true
  private orderedLoadGeneration = 0
  private orderingInvalidationGeneration = 0
  // Counts authoritative reads started. A request issued before one is
  // superseded: its failure raises the repair debt but blocks nothing.
  private authorityGeneration = 0
  private lastPage: { count: number; boundary: unknown } | undefined
  private lastPrefixCount: number | undefined
  // The count of the last request that read from the start of the order,
  // until a continuation reads past it.
  private ownPrefixCount: number | undefined
  private lastBoundary: unknown
  private needsOptimisticRefill = false
  private retiringSupersededAcquisitions = false
  private repairRetries = 0
  private repairTimer: ReturnType<typeof setTimeout> | undefined
  private stagedContinuation: OrderedContinuation | undefined
  private blockedLoadMore:
    | {
        windowOperationGeneration?: number
        continuesOrderedPrefixRepair: boolean
      }
    | undefined
  private drainingNoInputContinuations = false
  // The graph input revision at which a graph turn asked for more data while
  // a synchronous request was running. That turn has already processed the
  // request's writes, and it will not ask again.
  private graphCheckedDuringRequest: number | undefined
  // An eager source holds every row, so an index on a single order term can
  // answer a prefix with only the first rows of the window.
  private readonly readsBoundedPrefix: boolean

  constructor(
    private readonly info: OrderByOptimizationInfo,
    private readonly subscription: CollectionSubscription,
    private readonly alias: string,
    private readonly onResult: (
      result: LoadSubsetRequestResult,
      holdPublication: boolean,
      settlesAsync: boolean,
    ) => void = () => {},
    private readonly canRetryRepair: () => boolean = () => false,
    private readonly getGraphInputRevision?: () => number,
    private readonly hasPendingJoinedWork: () => boolean = () => false,
  ) {
    this.info.isRequesting = () => this.requesting
    // A joined filter drops rows after the source's limit, so a full window
    // after a bounded read would not prove it holds the first eligible rows.
    this.readsBoundedPrefix =
      info.sourceHoldsAllRows &&
      info.index !== undefined &&
      info.orderBy.length === 1 &&
      info.joinedFilterSourceId === undefined
  }

  private get needsOrderingRepair(): boolean {
    return this.debt !== `none`
  }

  // Every move of the work slot names the states it may leave. Any other
  // move, or a work and debt pair the rules forbid, is an invariant violation.
  private moveWork(
    next: AuthoritativeWork,
    from: ReadonlyArray<WorkState>,
    debt = this.debt,
  ): void {
    if (!from.includes(workState(this.work))) {
      throw new OrderedLoaderInvariantError(
        `Ordered loader work cannot move from ${workState(this.work)} to ${workState(next)}`,
      )
    }
    this.work = next
    this.debt = debt
    this.checkCoherence()
  }

  private oweDebt(next: RepairDebt): void {
    this.debt = next
    this.checkCoherence()
  }

  // Complete coverage owes nothing, a repair runs only to pay a debt, and a
  // failed full-source read owes its replacement.
  private checkCoherence(): void {
    const state = workState(this.work)
    if (
      (state === `complete` && this.debt !== `none`) ||
      (state === `repair` && this.debt === `none`) ||
      (state === `failed` && this.debt !== `full`)
    ) {
      throw new OrderedLoaderInvariantError(
        `Ordered loader work ${state} cannot owe ${this.debt} debt`,
      )
    }
  }

  private coversSource(): boolean {
    return this.work.kind === `full-source` && this.work.status === `complete`
  }

  // A repair whose epoch moved, or whose debt rose to a full-source read, is
  // replaced before it issues another tie or refill.
  private repairNeedsReplacement(): boolean {
    return (
      this.work.kind === `repair` &&
      (this.work.epoch !== this.orderingInvalidationGeneration ||
        this.debt === `full`)
    )
  }

  /** Derive invalidation from actual contributions, not a second cursor. */
  onSourceChanges(
    changes: Array<ChangeMessage<Record<string, unknown>, string | number>>,
    sentRows: ReadonlyMap<string | number, Record<string, unknown>> | undefined,
    hasOptimisticOverlay: (key: string | number) => boolean,
  ): void {
    let hasNewRows = false
    let hasOptimisticDeparture = false
    for (const change of changes) {
      const previous = sentRows?.get(change.key)
      // A finished repair holds every row through its boundary, so releasing
      // what it superseded removes only rows outside its coverage.
      if (change.type === `delete` && this.retiringSupersededAcquisitions) {
        continue
      }
      // A sent row that leaves or moves. An optimistic overlay may still
      // revert, so it only checks the local supply; a source move invalidates
      // the order.
      if (
        change.type !== `insert` &&
        previous !== undefined &&
        (change.type === `delete` ||
          this.info.comparator(previous, change.value) !== 0)
      ) {
        if (hasOptimisticOverlay(change.key)) hasOptimisticDeparture = true
        else {
          this.invalidateSourceOrdering()
          return
        }
      }
      if (change.type !== `delete` && previous === undefined) hasNewRows = true
    }
    if (hasOptimisticDeparture && !this.info.sourceHoldsAllRows) {
      const locallyAvailable = this.subscription
        .readOrderedSnapshot({
          orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
          limit: this.info.offset + this.info.limit,
        })
        .filter(({ key }) => !hasOptimisticOverlay(key)).length
      if (locallyAvailable < this.info.offset + this.info.limit) {
        this.needsOptimisticRefill = true
        this.invalidateCursor()
      }
    }
    // New keys, including ties, may need another page. Duplicate delivery or
    // an order-equal update cannot invalidate an already attempted request.
    if (hasNewRows) this.invalidateCursor()
  }

  start(): void {
    const { index, limit, offset, requiresFullSource } = this.info
    if (index) this.subscription.setOrderByIndex(index)
    if (limit === 0) return
    if (requiresFullSource) {
      this.loadFullSource()
      return
    }
    if (!index) {
      this.loadPrefix(offset + limit)
      return
    }
    this.loadPage(offset + limit)
  }

  loadMore(
    windowOperationGeneration?: number,
    continuesOrderedPrefixRepair = false,
  ): Promise<void> | undefined {
    if (this.requesting) {
      this.graphCheckedDuringRequest = this.getGraphInputRevision?.()
    }
    if (!this.active || this.info.limit === 0 || this.requesting) return
    windowOperationGeneration ??=
      this.blockedLoadMore?.windowOperationGeneration
    continuesOrderedPrefixRepair ||=
      this.blockedLoadMore?.continuesOrderedPrefixRepair ?? false
    if (this.info.joinedFilterSourceId && this.hasPendingJoinedWork()) {
      if (
        windowOperationGeneration !== undefined ||
        continuesOrderedPrefixRepair
      ) {
        this.blockedLoadMore = {
          windowOperationGeneration,
          continuesOrderedPrefixRepair,
        }
      }
      return this.pending
    }
    this.blockedLoadMore = undefined
    // A finite step staged under ordering debt cannot run ahead of the owed
    // read. An invalidation drops it. A failure, even one from before a
    // cursor reset that keeps the work staged after it, clears the boundary,
    // so a staged tie has nothing to read from, and a staged `more` step
    // runs this method, which follows the debt.
    if (this.stagedContinuation) {
      this.consumeStagedContinuation(windowOperationGeneration)
      // The consumed continuation can synchronously dispose this loader.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!this.active || this.pending) return this.pending
    }
    const mayRetryFailure =
      this.failedRequest === undefined ||
      (windowOperationGeneration !== undefined &&
        windowOperationGeneration !==
          this.failedRequest.windowOperationGeneration)
    if (!mayRetryFailure) return this.pending
    // A failed full-source read stops owning the source before its lease is
    // released, so a replay during or after a throwing release cannot count it.
    if (this.work.kind === `full-source` && this.work.status === `failed`) {
      this.moveWork({ kind: `idle` }, [`failed`])
    }
    if (
      (this.failedRequest || this.failedAcquisitions.size > 0) &&
      windowOperationGeneration !== undefined &&
      // The explicit retry releases them, not a repair-chain step that runs
      // inside it: a throwing release would unwind the chain mid-step.
      !continuesOrderedPrefixRepair
    ) {
      this.cancelRepairRetry()
      this.repairRetries = 0
      // Move ownership to the explicit replacement before releasing the old
      // acquisition lease. Adapter cleanup may reenter the loader.
      if (this.failedRequest) {
        this.failedRequest.windowOperationGeneration = windowOperationGeneration
      }
      // Adapter cleanup can synchronously tear down this loader; every later
      // step checks that it is still active.
      this.releaseOwned(this.failedAcquisitions, () => true)
    }
    if (
      this.work.kind !== `idle` &&
      !(continuesOrderedPrefixRepair && this.work.kind === `repair`)
    ) {
      if (windowOperationGeneration !== undefined) {
        // A window move held behind repair still needs its source-coverage
        // check when that repair resumes ordered loading.
        this.blockedLoadMore = {
          windowOperationGeneration,
          continuesOrderedPrefixRepair,
        }
      }
      return this.pending
    }
    if (
      (this.needsOrderingRepair &&
        !(continuesOrderedPrefixRepair && this.work.kind === `repair`)) ||
      this.info.requiresFullSource
    ) {
      if (this.debt === `bounded` && !this.info.requiresFullSource) {
        this.loadOrderedPrefixRepair(windowOperationGeneration)
      } else {
        this.loadFullSource(windowOperationGeneration)
      }
      return this.pending
    }
    if (!this.info.index) {
      const shouldLoad =
        windowOperationGeneration !== undefined ||
        this.needsOptimisticRefill ||
        (this.info.dataNeeded?.(this.settledSourceBoundary) ?? 0) > 0 ||
        (this.lastPrefixCount !== undefined &&
          this.lastPrefixCount < this.info.offset + this.info.limit)
      if (shouldLoad) {
        this.needsOptimisticRefill = false
        this.loadPrefix(
          this.info.offset + this.info.limit,
          windowOperationGeneration,
          continuesOrderedPrefixRepair,
        )
      } else if (continuesOrderedPrefixRepair) {
        this.finishOrderedPrefixRepair(windowOperationGeneration)
      }
      return this.pending
    }
    if (!this.info.dataNeeded || this.pending) {
      if (this.pending && windowOperationGeneration !== undefined) {
        // A window move can wait behind an ordered repair. Its source-coverage
        // check still belongs to the continuation after that repair settles.
        this.blockedLoadMore = {
          windowOperationGeneration,
          continuesOrderedPrefixRepair,
        }
      }
      if (continuesOrderedPrefixRepair && !this.pending) {
        this.finishOrderedPrefixRepair(windowOperationGeneration)
      }
      return this.pending
    }
    // A recorded failure always carries repair debt, so it cannot reach this
    // finite path; only the first request needs the whole prefix here.
    let count = Math.max(
      this.info.dataNeeded(this.settledSourceBoundary),
      this.hasSettledSourceRequest ? 0 : this.info.offset + this.info.limit,
      this.needsOptimisticRefill ? 1 : 0,
    )
    if (
      windowOperationGeneration !== undefined &&
      this.settledSourceBoundary !== undefined
    ) {
      const needed = this.info.offset + this.info.limit
      count = Math.max(count, needed - this.countAcquiredRows())
    }
    if (count > 0) {
      this.needsOptimisticRefill = false
      this.loadPage(
        count,
        windowOperationGeneration,
        continuesOrderedPrefixRepair,
      )
    } else if (continuesOrderedPrefixRepair) {
      this.finishOrderedPrefixRepair(windowOperationGeneration)
    }
    return this.pending
  }

  loadFullSource(windowOperationGeneration?: number): void {
    if (!this.active || this.work.kind !== `idle`) return
    // An authoritative read supersedes an in-flight finite request; the old
    // request still settles its own participant, and its result is ignored
    // for the boundary. Authority must not wait behind it, or nothing resumes
    // the work when the old request settles.
    this.pending = undefined
    this.moveWork({ kind: `full-source`, status: `held` }, [`idle`])
    this.requestAndObserve(
      (tracking) => this.subscription.requestSnapshot(tracking),
      `full-source`,
      windowOperationGeneration,
    )
  }

  private loadOrderedPrefixRepair(windowOperationGeneration?: number): void {
    if (!this.active || this.work.kind !== `idle`) return
    // As for a full-source read, the repair does not wait behind it.
    this.pending = undefined
    // Any older finite request may still settle, but it cannot refine from a
    // boundary that predates this authoritative prefix.
    this.moveWork(
      { kind: `repair`, epoch: this.orderingInvalidationGeneration },
      [`idle`],
    )
    this.ownPrefixCount = this.info.offset + this.info.limit
    this.requestAndObserve(
      (tracking) =>
        this.subscription.requestSnapshot({
          ...tracking,
          orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
          limit: this.info.offset + this.info.limit,
          boundedPrefix: this.readsBoundedPrefix,
        }),
      `ordered-repair`,
      windowOperationGeneration,
      true,
      this.info.offset + this.info.limit,
    )
  }

  private loadPrefix(
    count: number,
    windowOperationGeneration?: number,
    continuesOrderedPrefixRepair = false,
  ): void {
    if (!this.active || this.pending || this.stagedContinuation) return
    if (this.lastPrefixCount === count) {
      if ((this.info.dataNeeded?.(this.settledSourceBoundary) ?? 0) > 0) {
        if (continuesOrderedPrefixRepair) this.abandonOrderedPrefixRepair()
        this.loadFullSource(windowOperationGeneration)
      } else if (continuesOrderedPrefixRepair) {
        this.finishOrderedPrefixRepair(windowOperationGeneration)
      }
      return
    }
    this.requestAndObserve(
      (tracking) =>
        this.subscription.requestSnapshot({
          ...tracking,
          orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
          limit: count,
          boundedPrefix: this.readsBoundedPrefix,
        }),
      `ordered`,
      windowOperationGeneration,
      continuesOrderedPrefixRepair,
      count,
    )
    this.lastPrefixCount = count
    this.ownPrefixCount = count
  }

  resetCursor(): void {
    this.cancelRepairRetry()
    this.repairRetries = 0
    this.orderedLoadGeneration++
    if (this.coversSource())
      this.moveWork({ kind: `full-source`, status: `held` }, [`complete`])
    this.pending = undefined
    this.blockedLoadMore = undefined
    this.lastBoundary = undefined
    this.settledSourceBoundary = undefined
    this.stagedContinuation = undefined
    this.invalidateCursor()
  }

  settleFullSourceReplay(): void {
    if (this.work.kind === `repair`) {
      this.finishOrderedPrefixRepair()
      return
    }
    // Replay repaired the retained logical acquisition. A later window retry
    // must not release that now-successful source demand. A failed finite
    // page is still obsolete: the replay's full coverage releases it when
    // authoritative work superseded it, and the retry releases it otherwise.
    if (this.work.kind === `full-source` && this.work.status === `failed`) {
      for (const [release, { kind }] of this.failedAcquisitions) {
        if (kind === `full-source`) this.failedAcquisitions.delete(release)
      }
    }
    // The replay is the full-source read's success: it pays the debt.
    if (this.work.kind !== `idle`) {
      this.coverSource([`held`, `failed`, `complete`])
    }
  }

  // Full coverage pays every debt, ends the backoff retry, and retires both
  // kinds of lease; a throwing release in one pass must not skip the other.
  private coverSource(from: ReadonlyArray<WorkState>): void {
    this.cancelRepairRetry()
    this.repairRetries = 0
    this.moveWork({ kind: `full-source`, status: `complete` }, from, `none`)
    runAllCallbacks([
      () => this.retireSettledFiniteAcquisitions(),
      () => this.retireSupersededFailures(),
    ])
  }

  private retireSettledFiniteAcquisitions(
    prefix?: {
      release: ReleaseLoadSubset
      count: number
    },
    // Retire everything outside this repair chain, which keeps its own.
    keptChain?: number,
  ): void {
    if (
      (!this.coversSource() && !prefix && keptChain === undefined) ||
      this.subscription.hasPendingTruncateReplacement
    )
      return
    this.releaseOwned(
      this.settledFiniteAcquisitions,
      (release, { count, chain }) =>
        keptChain !== undefined
          ? chain !== keptChain
          : this.coversSource() ||
            (prefix !== undefined &&
              release !== prefix.release &&
              count !== undefined &&
              count <= prefix.count),
    )
  }

  // A full-source read covers every row, so it supersedes the partial writes
  // of each failed request that authoritative work had superseded.
  private retireSupersededFailures(): void {
    if (this.subscription.hasPendingTruncateReplacement) return
    this.releaseOwned(
      this.failedAcquisitions,
      (_, { superseded }) => superseded,
    )
  }

  // Release each selected lease once. A release that resets the cursor, which
  // dispose also does, stops the pass; the replay that follows owns the
  // remaining leases. A release can run the graph synchronously, so
  // refinement stays blocked until the pass unwinds.
  private releaseOwned<TEntry>(
    owner: Map<ReleaseLoadSubset, TEntry>,
    selected: (release: ReleaseLoadSubset, entry: TEntry) => boolean,
  ): void {
    const orderedLoadGeneration = this.orderedLoadGeneration
    const requesting = this.requesting
    this.requesting = true
    try {
      runAllCallbacks(
        Array.from(owner, ([release, entry]) => () => {
          if (
            orderedLoadGeneration !== this.orderedLoadGeneration ||
            !selected(release, entry)
          )
            return
          // Within one generation no other pass can reach this map while
          // refinement is blocked; a missing lease would be a double release.
          if (owner.get(release) !== entry) {
            throw new OrderedLoaderInvariantError(
              `Ordered loader lease was released by another pass`,
            )
          }
          owner.delete(release)
          // A release that throws never changes a load, a window, or the
          // loader's state; it is reported uncaught.
          try {
            release()
          } catch (error) {
            reportReleaseError(error)
          }
        }),
      )
    } finally {
      this.requesting = requesting
    }
  }

  invalidateCursor(): void {
    if ((this.stagedContinuation?.role ?? `finite`) === `finite`) {
      this.stagedContinuation = undefined
    }
    this.lastPage = undefined
    this.lastPrefixCount = undefined
  }

  invalidateSourceOrdering(): void {
    this.orderingInvalidationGeneration++
    this.invalidateCursor()
    this.lastBoundary = undefined
    // In-flight page or tie work does not force a full-source read. The
    // bounded repair starts at once, and that work's later result is ignored
    // for its boundary. Full-source reads can be very expensive.
    if (this.debt === `none` && !this.coversSource()) {
      this.oweDebt(
        this.hasSettledSourceRequest && this.work.kind === `idle`
          ? `bounded`
          : `full`,
      )
    }
    this.settledSourceBoundary = undefined
  }

  /**
   * The source's sync adapter reports that served pages may have shifted.
   * Coverage that one full-source acquisition established has no page
   * boundary to repair, and the adapter's refetch has already re-read it.
   * A window inside this loader's own first page needs no repair either.
   */
  revalidateLoadedCoverage(): void {
    // A `requiresFullSource` plan's coverage is its full-source read: nothing
    // has settled before it, and it covers the source after.
    if (!this.active || !this.hasSettledSourceRequest || this.coversSource())
      return
    const end = this.ownPrefixEnd()
    if (end === undefined) {
      this.invalidateSourceOrdering()
      return
    }
    // An installed row past the page proves the source's next row only when
    // the page read it, or when it ties with an end whose tie the loader
    // read. A refetch can move the end before that tie; reading the new
    // end's tie then proves the window.
    if (
      (this.ownPrefixCount ?? 0) > this.info.offset + this.info.limit ||
      // Undefined means that no tie request has been attempted.
      (this.lastBoundary !== undefined &&
        Object.is(this.info.valueExtractorForRawRow(end), this.lastBoundary))
    )
      return
    this.loadMovedEndTie(end)
  }

  // The refetched page still holds every row before its end, so the end's
  // tie completes the proof without a repair. The older tie's rows sort
  // after the end and outside the window, and they prove nothing now.
  private loadMovedEndTie(end: Record<string, unknown>): void {
    // Other work owns the boundary, a repair is already owed, a replay owns
    // the leases, or no cursor can express the end's tie, so only the
    // repair's full-source fallback can read it.
    if (
      !canExpressCursorOrder(
        normalizeOrderByPaths(this.info.orderBy, this.alias).slice(0, 1),
        [this.info.valueExtractorForRawRow(end)],
      ) ||
      this.debt !== `none` ||
      this.work.kind !== `idle` ||
      this.pending ||
      this.stagedContinuation ||
      this.subscription.hasPendingTruncateReplacement
    ) {
      this.invalidateSourceOrdering()
      return
    }
    const orderedLoadGeneration = this.orderedLoadGeneration
    // The release can delete rows only the older tie held. Those deletes
    // leave rows past the end, so they are not an order change.
    this.retiringSupersededAcquisitions = true
    try {
      this.releaseOwned(
        this.settledFiniteAcquisitions,
        (_, { tie }) => tie !== undefined && this.info.comparator(tie, end) > 0,
      )
    } finally {
      this.retiringSupersededAcquisitions = false
    }
    // A release that resets the cursor hands the window to the replay.
    if (!this.active || orderedLoadGeneration !== this.orderedLoadGeneration)
      return
    this.settledSourceBoundary = end
    // The pass that follows the report reads the tie, as a repair's first
    // request would start then, so a start that throws fails that pass.
    this.stagedContinuation = {
      orderedLoadGeneration,
      authorityGeneration: this.authorityGeneration,
      orderingInvalidationGeneration: this.orderingInvalidationGeneration,
      role: `finite`,
      kind: `boundary`,
      continuesOrderedPrefixRepair: false,
    }
  }

  // The refetched first page holds every row from the start of the order
  // through its end, and any row it left out sorts after that end. So a
  // window whose rows all sort at or before the end is right. A row after
  // the page that ties with its end could sort before a window row; then
  // the window is not proven. Returns the end when the window is inside
  // the page.
  private ownPrefixEnd(): Record<string, unknown> | undefined {
    const size = this.info.offset + this.info.limit
    // A report can arrive while the refetched rows are accepted but held
    // back, as behind a persisting optimistic transaction. The visible rows
    // then predate the refetch and prove nothing about its page.
    if (
      (this.ownPrefixCount ?? 0) < size ||
      !this.info.dataNeeded ||
      this.subscription.hasHeldSyncTransaction
    ) {
      return undefined
    }
    const rows = this.subscription.readOrderedSnapshot({
      orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
      limit: size + 1,
    })
    // Optimistic rows are left out, so a short read proves nothing.
    if (rows.length <= size) return undefined
    const end = rows[size - 1]!.value
    return this.info.comparator(rows[size]!.value, end) > 0 &&
      this.info.dataNeeded(end) === 0
      ? end
      : undefined
  }

  private finishOrderedPrefixRepair(windowOperationGeneration?: number): void {
    if (this.work.kind !== `repair`) return
    const epoch = this.work.epoch
    if (this.repairNeedsReplacement()) {
      // A later mutation invalidated the source order while this chain was
      // running. Start its replacement before the current participant settles
      // so Collection and Effect publication remain behind one continuous gate.
      this.moveWork({ kind: `idle` }, [`repair`])
      // A failure during the chain raised the debt to a full-source read.
      if (this.debt === `full`) {
        this.loadFullSource(windowOperationGeneration)
      } else {
        this.loadOrderedPrefixRepair(windowOperationGeneration)
      }
      return
    }
    this.retiringSupersededAcquisitions = true
    try {
      this.retireSettledFiniteAcquisitions(undefined, epoch)
    } finally {
      this.retiringSupersededAcquisitions = false
      const hasSupersededAcquisition = [
        ...this.settledFiniteAcquisitions.values(),
      ].some(({ chain }) => chain !== epoch)
      // A release callback may synchronously begin truncate replay. Keep the
      // repair ownership open so replay settlement can finish retiring the
      // remaining superseded leases without releasing the refreshed prefix.
      if (!this.active || !hasSupersededAcquisition) {
        this.cancelRepairRetry()
        this.repairRetries = 0
        this.moveWork({ kind: `idle` }, [`repair`], `none`)
      }
    }
  }

  private abandonOrderedPrefixRepair(): void {
    if (this.work.kind !== `repair`) return
    this.moveWork({ kind: `idle` }, [`repair`], `full`)
  }

  dispose(): void {
    this.active = false
    this.resetCursor()
    this.failedAcquisitions.clear()
    this.settledFiniteAcquisitions.clear()
  }

  private countAcquiredRows(): number {
    return this.subscription
      .readOrderedSnapshot({
        orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
        limit: this.info.offset + this.info.limit,
      })
      .filter(
        ({ value }) =>
          this.info.comparator(value, this.settledSourceBoundary) <= 0,
      ).length
  }

  private loadPage(
    count: number,
    windowOperationGeneration?: number,
    continuesOrderedPrefixRepair = false,
  ): void {
    if (!this.active || this.pending || this.stagedContinuation) return
    // Rows observed before the first provider request do not prove ordered
    // source coverage. In particular, a row inserted while limit is zero must
    // not become the cursor when that window first opens.
    const startsFromSourcePrefix = this.settledSourceBoundary === undefined
    const biggest = this.settledSourceBoundary
    let minValues: Array<unknown> | undefined
    if (biggest !== undefined) {
      const value = this.info.valueExtractorForRawRow(biggest)
      if (!canExpressCursorOrder(this.info.orderBy, [value])) {
        this.loadPrefix(
          this.info.offset + this.info.limit,
          windowOperationGeneration,
          continuesOrderedPrefixRepair,
        )
        return
      }
      minValues = [value]
    }
    const boundary = minValues?.[0]
    if (
      this.lastPage?.count === count &&
      Object.is(this.lastPage.boundary, boundary)
    ) {
      if (continuesOrderedPrefixRepair) {
        this.finishOrderedPrefixRepair(windowOperationGeneration)
      }
      return
    }
    this.lastPage = { count, boundary }
    this.ownPrefixCount = startsFromSourcePrefix ? count : undefined
    this.requestAndObserve(
      (tracking) =>
        this.subscription.requestLimitedSnapshot({
          ...tracking,
          orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
          limit: count,
          minValues,
          // Local rows seen before the first provider request prove neither
          // a cursor nor a remote offset. Start the first acquisition at zero.
          offset: startsFromSourcePrefix ? 0 : this.countAcquiredRows(),
        }),
      `ordered`,
      windowOperationGeneration,
      continuesOrderedPrefixRepair,
      count,
    )
  }

  // A result is dead after a cursor reset. A non-authoritative result is stale
  // after an ordering invalidation: it proves no current coverage.
  private standing(stamp: RequestStamp): `dead` | `stale` | `current` {
    if (stamp.orderedLoadGeneration !== this.orderedLoadGeneration)
      return `dead`
    // A replacement repair or a full-source read started after a repair
    // chain supersedes it; a chain that finished still owns its requests. A
    // finite request is stale once the ordering epoch moves. A full-source
    // read stays current.
    const stale =
      stamp.role === `repair`
        ? this.supersedes(stamp)
        : stamp.role === `finite` &&
          stamp.orderingInvalidationGeneration !==
            this.orderingInvalidationGeneration
    return stale ? `stale` : `current`
  }

  // Authoritative work started after the request was issued.
  private supersedes(stamp: RequestStamp): boolean {
    return stamp.authorityGeneration !== this.authorityGeneration
  }

  private runContinuation(
    continuation: OrderedContinuation,
    windowOperationGeneration = continuation.windowOperationGeneration,
  ): void {
    if (!this.active || this.standing(continuation) !== `current`) return
    if (continuation.kind === `boundary`) {
      this.loadBoundary(
        windowOperationGeneration,
        continuation.continuesOrderedPrefixRepair,
      )
    } else {
      if (this.info.joinedFilterSourceId && this.hasPendingJoinedWork()) {
        this.stagedContinuation = continuation
        return
      }
      this.loadMore(
        windowOperationGeneration,
        continuation.continuesOrderedPrefixRepair,
      )
    }
  }

  private consumeStagedContinuation(windowOperationGeneration?: number): void {
    const continuation = this.stagedContinuation
    if (!continuation) return
    this.stagedContinuation = undefined
    this.runContinuation(continuation, windowOperationGeneration)
  }

  // A staged continuation waits for the graph to process the writes that
  // staged it; the graph turn that does so resumes it. If no write arrived
  // since `graphInputRevision`, or a graph turn already processed every
  // write while the request ran and asked for more, no turn will resume it,
  // so the loader continues now.
  private graphHasProcessedInput(graphInputRevision: number): boolean {
    const revision = this.getGraphInputRevision?.()
    return (
      revision === graphInputRevision ||
      revision === this.graphCheckedDuringRequest
    )
  }

  private drainNoInputContinuations(graphInputRevision: number): void {
    if (this.drainingNoInputContinuations) return
    this.drainingNoInputContinuations = true
    try {
      while (
        this.stagedContinuation &&
        !this.pending &&
        this.graphHasProcessedInput(graphInputRevision)
      ) {
        this.consumeStagedContinuation()
      }
    } finally {
      this.drainingNoInputContinuations = false
    }
  }

  private loadBoundary(
    windowOperationGeneration?: number,
    continuesOrderedPrefixRepair = false,
  ): Promise<void> | undefined {
    const biggest = this.settledSourceBoundary
    if (biggest === undefined) {
      return continuesOrderedPrefixRepair
        ? this.loadMore(windowOperationGeneration, true)
        : undefined
    }
    const value = this.info.valueExtractorForRawRow(biggest)
    const orderBy = normalizeOrderByPaths(this.info.orderBy, this.alias)
    if (!canExpressCursorOrder(orderBy.slice(0, 1), [value])) {
      if (continuesOrderedPrefixRepair) this.abandonOrderedPrefixRepair()
      this.loadFullSource(windowOperationGeneration)
      return this.pending
    }
    // Undefined is not an expressible cursor boundary, so it denotes that no
    // tie request has been attempted. Other falsy values remain valid keys.
    if (Object.is(this.lastBoundary, value)) {
      return this.loadMore(
        windowOperationGeneration,
        continuesOrderedPrefixRepair,
      )
    }
    const where = buildCursorCurrent(orderBy, [value])
    if (!where) {
      if (continuesOrderedPrefixRepair) this.abandonOrderedPrefixRepair()
      this.loadFullSource(windowOperationGeneration)
      return this.pending
    }
    this.lastBoundary = value
    return this.requestAndObserve(
      (tracking) => this.subscription.requestSnapshot({ ...tracking, where }),
      `boundary`,
      windowOperationGeneration,
      continuesOrderedPrefixRepair,
    )
  }

  private requireFullSourceRepair(): void {
    this.settledSourceBoundary = undefined
    // A running repair sees the full debt and is replaced by that read. Full
    // coverage owes nothing.
    if (!this.coversSource()) this.oweDebt(`full`)
  }

  private cancelRepairRetry(): void {
    clearTimeout(this.repairTimer)
    this.repairTimer = undefined
  }

  // Only the loader's own failure outside a window move schedules a retry.
  // That failure blocks the ordinary passes that could fail again, and the
  // timer clears itself before it retries, so no timer is pending here. An
  // explicit move cancels the timer before it takes the failure over.
  private scheduleRepairRetry(): void {
    if (!this.active || !this.canRetryRepair() || this.repairRetries >= 2)
      return
    const orderedLoadGeneration = this.orderedLoadGeneration
    const failedRequest = this.failedRequest
    this.repairTimer = setTimeout(
      () => {
        this.repairTimer = undefined
        const retry = Promise.resolve().then(() => {
          if (
            !this.active ||
            !this.canRetryRepair() ||
            orderedLoadGeneration !== this.orderedLoadGeneration ||
            this.failedRequest !== failedRequest
          )
            return
          this.moveWork({ kind: `idle` }, [`idle`, `failed`])
          this.releaseOwned(this.failedAcquisitions, () => true)
          // Release may dispose or start a new replay; neither belongs to this retry.
          if (
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- release callbacks can dispose the loader
            !this.active ||
            orderedLoadGeneration !== this.orderedLoadGeneration ||
            this.subscription.hasPendingTruncateReplacement
          )
            return
          this.failedRequest = undefined
          this.loadFullSource()
        })
        void retry.catch(() => {})
        this.onResult(retry, true, true)
      },
      250 * 2 ** this.repairRetries++,
    )
  }

  /** A failed request blocks ordinary refinement until a new operation. */
  private recordRequestFailure(windowOperationGeneration?: number): void {
    this.failedRequest = { windowOperationGeneration }
    this.stagedContinuation = undefined
    this.blockedLoadMore = undefined
    this.invalidateCursor()
    this.lastBoundary = undefined
  }

  /** Observe settlement only after all synchronous request work succeeds. */
  private requestAndObserve(
    request: (tracking: {
      refetch?: true
      trackLoadSubsetPromise: false
      onLoadSubsetResult: (
        result: LoadSubsetRequestResult,
        options: LoadSubsetOptions,
        release: ReleaseLoadSubset,
      ) => void
    }) => void,
    kind: OrderedRequestKind,
    windowOperationGeneration?: number,
    continuesOrderedPrefixRepair = false,
    requestedCount?: number,
  ): Promise<void> | undefined {
    const isFullSource = kind === `full-source`
    const isOrderedRepair = kind === `ordered-repair`
    const tie = kind === `boundary` ? this.settledSourceBoundary : undefined
    const isAuthoritativeRequest =
      isFullSource || isOrderedRepair || continuesOrderedPrefixRepair
    let observed:
      | {
          result: LoadSubsetRequestResult
          options: LoadSubsetOptions
          release: ReleaseLoadSubset
        }
      | undefined
    this.requesting = true
    this.graphCheckedDuringRequest = undefined
    let observing = false
    const graphInputRevision = this.getGraphInputRevision?.()
    // A request belongs to the ordering epoch it is issued in. Its own
    // synchronous delivery can invalidate ordering before it returns; it
    // still proves no coverage for the newer epoch.
    const issuedOrderingGeneration = this.orderingInvalidationGeneration
    try {
      try {
        // Authoritative work re-reads the source, except a full-source read
        // that owes no ordering repair.
        request({
          ...((isFullSource ? this.needsOrderingRepair : isAuthoritativeRequest)
            ? { refetch: true }
            : {}),
          trackLoadSubsetPromise: false,
          onLoadSubsetResult: (result, options, release) => {
            observed = { result, options, release }
          },
        })
      } finally {
        this.requesting = false
      }
      // An authoritative read supersedes in-flight finite requests once it
      // is issued; one that throws while starting supersedes nothing.
      if (isFullSource || isOrderedRepair) {
        this.authorityGeneration++
      }
      if (!observed) return
      observing = true
      const { result, options, release } = observed
      const retryRepair =
        isAuthoritativeRequest &&
        this.hasSettledSourceRequest &&
        this.needsOrderingRepair &&
        windowOperationGeneration === undefined
      // A repair request belongs to the chain it is issued in. One that settles
      // after its replacement started is outside the replacement's chain.
      const chain =
        (isOrderedRepair || continuesOrderedPrefixRepair) &&
        this.work.kind === `repair`
          ? this.work.epoch
          : undefined
      const stamp: RequestStamp = {
        orderedLoadGeneration: this.orderedLoadGeneration,
        authorityGeneration: this.authorityGeneration,
        orderingInvalidationGeneration: issuedOrderingGeneration,
        role: isFullSource
          ? `full-source`
          : isAuthoritativeRequest
            ? `repair`
            : `finite`,
      }
      const settlesAsync = result instanceof Promise
      const canSettleSynchronously =
        !settlesAsync &&
        windowOperationGeneration === undefined &&
        // A full-source request without ordering-repair debt can finish in the
        // current graph turn, including an initial fallback. A bounded prefix
        // repair reads only installed rows and can also finish in that turn.
        // Other repairs keep asynchronous settlement.
        (!isAuthoritativeRequest ||
          (isFullSource
            ? !this.needsOrderingRepair
            : this.readsBoundedPrefix)) &&
        graphInputRevision !== undefined
      let synchronousCompletionFailure: { error: unknown } | undefined
      const continuation = (
        continuationKind: OrderedContinuation[`kind`],
      ): OrderedContinuation => ({
        ...stamp,
        kind: continuationKind,
        windowOperationGeneration,
        continuesOrderedPrefixRepair,
      })
      const continueOrStage = (
        next: OrderedContinuation,
        deferContinuation: boolean,
      ): void => {
        if (deferContinuation) {
          this.stagedContinuation = next
        } else {
          this.runContinuation(next)
        }
      }
      const complete = (
        trackedRequest?: Promise<void>,
        deferContinuation = false,
      ): void => {
        if (trackedRequest && this.pending === trackedRequest) {
          this.pending = undefined
        }
        if (!this.active) return
        // A callback that fails after a successful acquisition does not undo
        // it. Finish its boundary and continuation, then report the first error.
        runAllCallbacks([
          () => {
            if (!isFullSource) {
              // A replay can replace the acquisition lease while this older
              // transport finishes. Retire its logical owner only outside the
              // replay barrier.
              const prefixCount =
                options.orderBy && !options.cursor ? options.limit : undefined
              this.settledFiniteAcquisitions.set(release, {
                count: prefixCount,
                chain,
                tie,
              })
              // Full-source coverage also retires a repair request that
              // settles after it.
              this.retireSettledFiniteAcquisitions()
              // A prefix issued before an ordering invalidation proves no
              // current coverage, so it cannot supersede the repair's prefix.
              if (
                !continuesOrderedPrefixRepair &&
                this.standing(stamp) === `current` &&
                prefixCount !== undefined
              ) {
                this.retireSettledFiniteAcquisitions({
                  release: release,
                  count: prefixCount,
                })
              }
              // A request issued before an ordering invalidation that settles
              // after the repair finished is already superseded by that repair.
              if (
                this.standing(stamp) === `stale` &&
                this.work.kind === `idle` &&
                !this.needsOrderingRepair &&
                this.settledFiniteAcquisitions.delete(release)
              ) {
                this.retiringSupersededAcquisitions = true
                try {
                  release()
                } catch (error) {
                  reportReleaseError(error)
                } finally {
                  this.retiringSupersededAcquisitions = false
                }
              }
            }
          },
          () => {
            if (this.standing(stamp) !== `current`) return
            // A finite request may finish behind an authoritative repair. It cannot
            // clear that repair's failure or resume finite refinement around it.
            if (
              !isAuthoritativeRequest &&
              (this.failedRequest || this.work.kind !== `idle`)
            )
              return
            this.failedRequest = undefined
            if (kind !== `boundary`) {
              this.hasSettledSourceRequest = true
              // Source delivery can invalidate the in-flight prefix marker.
              if (options.orderBy && !options.cursor) {
                this.lastPrefixCount = options.limit
              }
              if (!isFullSource && options.orderBy) {
                try {
                  this.settledSourceBoundary =
                    this.subscription
                      .readOrderedSnapshot({
                        ...options,
                        // Provider limits include optimistic headroom. Those
                        // extra local ranks do not prove a source boundary.
                        limit: requestedCount ?? options.limit,
                      })
                      .at(-1)?.value ?? this.settledSourceBoundary
                } catch (error) {
                  if (canSettleSynchronously) {
                    synchronousCompletionFailure = { error }
                    throw error
                  }
                  fail(error)
                }
              }
            }
            if (
              (isOrderedRepair || continuesOrderedPrefixRepair) &&
              (this.work.kind !== `repair` || this.repairNeedsReplacement())
            ) {
              // The settled request may apply its rows, but a later mutation has
              // already invalidated this chain. Replace it before issuing stale
              // tie or refill work.
              this.finishOrderedPrefixRepair(windowOperationGeneration)
              return
            }
            if (isFullSource) this.coverSource([`held`, `complete`])
            if (isOrderedRepair || kind === `ordered`) {
              continueOrStage(continuation(`boundary`), deferContinuation)
              return
            }
            // A boundary request may add tied rows without filling the query's
            // window. Resume forward loading once it settles.
            continueOrStage(continuation(`more`), deferContinuation)
          },
        ])
      }
      const fail = (error: unknown, trackedRequest?: Promise<void>) => {
        this.settledFiniteAcquisitions.delete(release)
        if (trackedRequest && this.pending === trackedRequest) {
          this.pending = undefined
        }
        // Dispose resets the cursor, so a disposed loader's requests are dead.
        // A replay already reacquired this full-source read's demand. Its late
        // transport failure leaves that coverage, and its lease, in place.
        if (isFullSource && this.coversSource()) return
        // A failed request may already have written only part of its result.
        // None of those rows is a safe continuation boundary.
        this.requireFullSourceRepair()
        // Work staged after a cursor reset belongs to the new generation.
        if (this.standing(stamp) === `dead`) return
        // Only the running authoritative work owns its staged step; a replaced
        // chain's request is stale and drops nothing. A chain request owns
        // authority only while its chain runs: one whose chain a replay
        // finished is superseded by that replay.
        const ownsAuthority =
          isAuthoritativeRequest &&
          this.standing(stamp) === `current` &&
          (isFullSource || this.work.kind === `repair`)
        if (
          ownsAuthority ||
          (this.stagedContinuation?.role ?? `finite`) === `finite`
        ) {
          this.stagedContinuation = undefined
        }
        // Authoritative work started after this request supersedes it. Its
        // failure is not the loader's own: its partial writes only raise the
        // debt to the full-source read that the overlap replaced. A running
        // repair restarts as that read; otherwise it starts now, unless the
        // loader's own failure is waiting for an explicit retry.
        if (isAuthoritativeRequest ? !ownsAuthority : this.supersedes(stamp)) {
          this.failedAcquisitions.set(release, {
            kind,
            superseded: true,
          })
          // Full-source coverage may already have covered its rows.
          if (this.coversSource()) {
            this.retireSupersededFailures()
          }
          this.invalidateCursor()
          this.lastBoundary = undefined
          // The loader's own recorded failure still waits for an explicit retry.
          if (this.failedRequest === undefined && this.work.kind === `idle`) {
            // A recovery read that throws while it starts is the loader's own
            // failure, recorded and reported on its own; this request still
            // reports its error.
            try {
              this.loadFullSource(windowOperationGeneration)
            } catch (startError) {
              if (startError instanceof OrderedLoaderInvariantError) {
                throw startError
              }
            }
          }
          throw error
        }
        // A failed request proves no full-source coverage. An explicit window
        // move or later replay may retry it, but an ordinary graph pass must
        // not start an eager retry loop.
        if (isFullSource) {
          this.moveWork({ kind: `full-source`, status: `failed` }, [`held`])
        } else if (isAuthoritativeRequest) {
          this.moveWork({ kind: `idle` }, [`repair`])
        }
        this.recordRequestFailure(windowOperationGeneration)
        this.failedAcquisitions.set(release, {
          kind,
          superseded: false,
        })
        if (retryRepair) this.scheduleRepairRetry()
        throw error
      }
      if (canSettleSynchronously) {
        try {
          runAllCallbacks([
            () => complete(undefined, true),
            () => {
              if (!synchronousCompletionFailure) {
                this.onResult(true, false, false)
              }
            },
            () => {
              if (
                !synchronousCompletionFailure &&
                this.graphHasProcessedInput(graphInputRevision)
              ) {
                this.drainNoInputContinuations(graphInputRevision)
              }
            },
          ])
        } catch (error) {
          if (synchronousCompletionFailure) {
            throw synchronousCompletionFailure.error
          }
          throw new OrderedPostSettlementError(error)
        }
        return this.pending
      }
      const transport: Promise<void> = settlesAsync ? result : Promise.resolve()
      const tracked: Promise<void> = transport.then(
        () => complete(tracked),
        (error) => fail(error, tracked),
      )
      this.pending = tracked
      void tracked.catch(() => {})
      // Register each request separately. The operation tracker observes the
      // next request before this promise settles, so the logical chain remains
      // pending without retaining every ancestor promise until the final page.
      this.onResult(
        tracked,
        isAuthoritativeRequest && this.needsOrderingRepair,
        settlesAsync,
      )
      return tracked
    } catch (error) {
      if (error instanceof OrderedPostSettlementError) throw error.cause
      if (error instanceof OrderedLoaderInvariantError) throw error
      // Both request and settlement callbacks may reenter through cleanup.
      // Keep refinement blocked until failure and release finish unwinding.
      this.requesting = true
      try {
        const failure = normalizeError(error)
        // A settlement that failed synchronously is not observed again.
        if (observing) {
          this.orderedLoadGeneration++
          this.pending = undefined
        }
        this.requireFullSourceRepair()
        this.recordRequestFailure(windowOperationGeneration)
        if (isAuthoritativeRequest) {
          this.moveWork({ kind: `idle` }, [`held`, `repair`])
        }
        try {
          observed?.release({ error: failure })
        } catch (releaseError) {
          reportReleaseError(releaseError)
        }
        if (isAuthoritativeRequest && this.hasSettledSourceRequest) {
          if (windowOperationGeneration === undefined) {
            this.scheduleRepairRetry()
          }
          if (!observing) {
            // A synchronous repair failure has no transport promise, but must
            // still close publication before the triggering graph turn
            // returns.
            const rejected = Promise.reject(failure)
            void rejected.catch(() => {})
            this.onResult(rejected, true, true)
          }
        }
        throw failure
      } finally {
        this.requesting = false
      }
    }
  }
}
