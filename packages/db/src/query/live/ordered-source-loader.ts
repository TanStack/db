import {
  buildCursorCurrent,
  canExpressCursorOrder,
} from '../../utils/cursor.js'
import { normalizeError } from '../../utils/error.js'
import { runAllCallbacks } from '../../utils/callbacks.js'
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

// The generations a request or its continuation carries from issue.
type RequestStamp = {
  orderedLoadGeneration: number
  orderingInvalidationGeneration: number
  isAuthoritativeRequest: boolean
}

type OrderedContinuation = RequestStamp & {
  kind: `boundary` | `more`
  windowOperationGeneration?: number
  continuesOrderedPrefixRepair: boolean
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
  // Independent of ordinary finite success: an authoritative full-source or
  // ordered-prefix refresh repairs ordering.
  private needsOrderingRepair = false
  // A live delete or order-changing update invalidates the settled prefix,
  // but unlike a failed request it cannot have partially written unknown rows.
  // Re-reading the exact ordered prefix is therefore authoritative for the
  // current window and preserves the provider query shape.
  private canRepairWithOrderedPrefix = false
  private requesting = false
  // Retaining a demand does not prove it succeeded. Async failure retains it
  // (`failed`) for replay; a synchronous startup failure retains nothing.
  private authoritativeRequestState: `none` | `held` | `complete` | `failed` =
    `none`
  private authoritativeRequestKind: `ordered-repair` | `full-source` | undefined
  // Keep callbacks, not copied requests or rows. Successful full-source work
  // subsumes these logical owners; unfinished transports remain observed.
  // Each records its prefix count and the ordering epoch it was issued in.
  private settledFiniteAcquisitions = new Map<
    ReleaseLoadSubset,
    { count: number | undefined; epoch: number }
  >()
  // The ordering epoch of the last bounded repair that finished: settled
  // acquisitions older than it are superseded.
  private coverageEpoch: number | undefined
  // The record's presence blocks automatic retry, including initial requests
  // that have no explicit window-operation generation.
  private failedRequest:
    { windowOperationGeneration: number | undefined } | undefined
  private failedAcquisitions = new Map<ReleaseLoadSubset, OrderedRequestKind>()
  private active = true
  private orderedLoadGeneration = 0
  private orderingInvalidationGeneration = 0
  // Counts authoritative reads started. A request issued before one is
  // superseded: its failure raises the repair debt but blocks nothing.
  private authorityGeneration = 0
  private orderedPrefixRepairGeneration: number | undefined
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
      if (
        hasOptimisticOverlay(change.key) &&
        change.type !== `insert` &&
        previous !== undefined &&
        (change.type === `delete` ||
          this.info.comparator(previous, change.value) !== 0)
      ) {
        hasOptimisticDeparture = true
      }
      if (
        !hasOptimisticOverlay(change.key) &&
        change.type !== `insert` &&
        previous !== undefined &&
        (change.type === `delete` ||
          this.info.comparator(previous, change.value) !== 0)
      ) {
        this.invalidateSourceOrdering()
        return
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
    if (this.stagedContinuation) {
      // A synchronous finite request can deliver an order-changing mutation.
      // Its continuation is staged after that mutation invalidates ordering,
      // so authoritative repair must supersede the stale finite chain.
      if (
        this.needsOrderingRepair &&
        !this.stagedContinuation.isAuthoritativeRequest
      ) {
        this.stagedContinuation = undefined
      } else {
        this.consumeStagedContinuation(windowOperationGeneration)
        // The consumed continuation can synchronously dispose this loader.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!this.active || this.pending) return this.pending
      }
    }
    const mayRetryFailure =
      this.failedRequest === undefined ||
      (windowOperationGeneration !== undefined &&
        windowOperationGeneration !==
          this.failedRequest.windowOperationGeneration)
    if (!mayRetryFailure) return this.pending
    if (
      (this.failedRequest || this.failedAcquisitions.size > 0) &&
      windowOperationGeneration !== undefined
    ) {
      this.cancelRepairRetry()
      this.repairRetries = 0
      // Move ownership to the explicit replacement before releasing the old
      // acquisition lease. Adapter cleanup may reenter the loader.
      if (this.failedRequest) {
        this.failedRequest.windowOperationGeneration = windowOperationGeneration
      }
      this.releaseFailedAcquisitions()
      // Adapter cleanup can synchronously tear down this loader.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!this.active) return
    }
    if (this.authoritativeRequestState === `failed`) {
      this.authoritativeRequestState = `none`
    } else if (
      this.authoritativeRequestState !== `none` &&
      !(
        continuesOrderedPrefixRepair &&
        this.authoritativeRequestKind === `ordered-repair`
      )
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
        !(
          continuesOrderedPrefixRepair &&
          this.authoritativeRequestKind === `ordered-repair`
        )) ||
      this.info.requiresFullSource
    ) {
      if (this.canRepairWithOrderedPrefix && !this.info.requiresFullSource) {
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
        (this.info.dataNeeded?.() ?? 0) > 0 ||
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
    if (!this.active || this.authoritativeRequestState !== `none`) return
    this.authorityGeneration++
    this.authoritativeRequestState = `held`
    this.authoritativeRequestKind = `full-source`
    this.requestAndObserve(
      (onLoadSubsetResult) => {
        this.subscription.requestSnapshot({
          ...(this.needsOrderingRepair ? { refetch: true } : {}),
          trackLoadSubsetPromise: false,
          onLoadSubsetResult,
        })
      },
      `full-source`,
      windowOperationGeneration,
    )
  }

  private loadOrderedPrefixRepair(windowOperationGeneration?: number): void {
    if (!this.active || this.authoritativeRequestState !== `none`) return
    this.authorityGeneration++
    // Any older finite request may still settle, but it cannot refine from a
    // boundary that predates this authoritative prefix.
    this.orderedPrefixRepairGeneration = this.orderingInvalidationGeneration
    this.authoritativeRequestState = `held`
    this.authoritativeRequestKind = `ordered-repair`
    this.ownPrefixCount = this.info.offset + this.info.limit
    this.requestAndObserve(
      (onLoadSubsetResult) => {
        this.subscription.requestSnapshot({
          refetch: true,
          orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
          limit: this.info.offset + this.info.limit,
          boundedPrefix: this.readsBoundedPrefix,
          trackLoadSubsetPromise: false,
          onLoadSubsetResult,
        })
      },
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
      (onLoadSubsetResult) => {
        this.subscription.requestSnapshot({
          ...(continuesOrderedPrefixRepair ? { refetch: true } : {}),
          orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
          limit: count,
          boundedPrefix: this.readsBoundedPrefix,
          trackLoadSubsetPromise: false,
          onLoadSubsetResult,
        })
      },
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
    if (this.authoritativeRequestState === `complete`)
      this.authoritativeRequestState = `held`
    this.pending = undefined
    this.blockedLoadMore = undefined
    this.lastBoundary = undefined
    this.settledSourceBoundary = undefined
    this.stagedContinuation = undefined
    this.invalidateCursor()
  }

  settleFullSourceReplay(): void {
    if (this.authoritativeRequestKind === `ordered-repair`) {
      this.finishOrderedPrefixRepair()
      return
    }
    // Replay repaired the retained logical acquisition. A later window retry
    // must not release that now-successful source demand. A failed finite
    // page is still obsolete and must be released by that retry.
    if (this.authoritativeRequestState === `failed`) {
      for (const [release, kind] of this.failedAcquisitions) {
        if (kind === `full-source`) this.failedAcquisitions.delete(release)
      }
      this.authoritativeRequestState = `held`
    }
    if (this.authoritativeRequestState !== `none`) {
      this.authoritativeRequestState = `complete`
      this.authoritativeRequestKind = undefined
      this.retireSettledFiniteAcquisitions()
    }
  }

  private retireSettledFiniteAcquisitions(
    prefix?: {
      release: ReleaseLoadSubset
      count: number
    },
    olderThan?: number,
  ): void {
    if (
      (this.authoritativeRequestState !== `complete` &&
        !prefix &&
        olderThan === undefined) ||
      this.subscription.hasPendingTruncateReplacement
    )
      return
    const orderedLoadGeneration = this.orderedLoadGeneration
    runAllCallbacks(
      Array.from(
        this.settledFiniteAcquisitions,
        ([release, { count, epoch }]) =>
          () => {
            if (olderThan !== undefined && epoch >= olderThan) return
            if (
              !this.active ||
              orderedLoadGeneration !== this.orderedLoadGeneration
            )
              return
            if (
              this.authoritativeRequestState !== `complete` &&
              olderThan === undefined &&
              (!prefix ||
                release === prefix.release ||
                count === undefined ||
                count > prefix.count)
            )
              return
            this.settledFiniteAcquisitions.delete(release)
            release()
          },
      ),
    )
  }

  // Release every settled acquisition older than a finished repair's epoch.
  // The repair holds every row through its boundary, so these removals are
  // not source-order changes. Returns whether any older one remains, as when
  // a release callback begins truncate replay.
  private retireSuperseded(epoch: number): boolean {
    this.retiringSupersededAcquisitions = true
    try {
      this.retireSettledFiniteAcquisitions(undefined, epoch)
    } finally {
      this.retiringSupersededAcquisitions = false
    }
    return [...this.settledFiniteAcquisitions.values()].some(
      (entry) => entry.epoch < epoch,
    )
  }

  invalidateCursor(): void {
    if (!this.stagedContinuation?.isAuthoritativeRequest) {
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
    if (
      !this.needsOrderingRepair &&
      this.hasSettledSourceRequest &&
      this.authoritativeRequestState === `none`
    ) {
      this.canRepairWithOrderedPrefix = true
    }
    this.settledSourceBoundary = undefined
    this.needsOrderingRepair = true
  }

  /**
   * The source's sync adapter reports that served pages may have shifted.
   * Coverage that one full-source acquisition established has no page
   * boundary to repair, and the adapter's refetch has already re-read it.
   * A window inside this loader's own first page needs no repair either.
   */
  revalidateLoadedCoverage(): void {
    if (
      !this.active ||
      this.info.requiresFullSource ||
      !this.hasSettledSourceRequest ||
      this.authoritativeRequestState === `complete` ||
      this.windowIsInsideOwnPrefix()
    )
      return
    this.invalidateSourceOrdering()
  }

  // The refetched first page holds every row from the start of the order
  // through its end, and any row it left out sorts after that end. So a
  // window whose rows all sort at or before the end is right. A row after
  // the page that ties with its end could sort before a window row; then
  // the window is not proven.
  private windowIsInsideOwnPrefix(): boolean {
    const size = this.info.offset + this.info.limit
    // A report can arrive while the refetched rows are accepted but held
    // back, as behind a persisting optimistic transaction. The visible rows
    // then predate the refetch and prove nothing about its page.
    if (
      (this.ownPrefixCount ?? 0) < size ||
      !this.info.dataNeeded ||
      this.subscription.hasHeldSyncTransaction
    ) {
      return false
    }
    const rows = this.subscription.readOrderedSnapshot({
      orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
      limit: size + 1,
    })
    // Optimistic rows are left out, so a short read proves nothing.
    if (rows.length <= size) return false
    const end = rows[size - 1]!.value
    return (
      this.info.comparator(rows[size]!.value, end) > 0 &&
      this.info.dataNeeded(end) === 0
    )
  }

  private finishOrderedPrefixRepair(windowOperationGeneration?: number): void {
    if (this.authoritativeRequestKind !== `ordered-repair`) return
    if (
      this.orderedPrefixRepairGeneration !== this.orderingInvalidationGeneration
    ) {
      // A later mutation invalidated the source order while this chain was
      // running. Start its replacement before the current participant settles
      // so Collection and Effect publication remain behind one continuous gate.
      this.authoritativeRequestState = `none`
      this.authoritativeRequestKind = undefined
      this.orderedPrefixRepairGeneration = undefined
      if (!this.active) return
      // A failure during the chain raised the debt to a full-source read.
      if (this.failedRequest || !this.canRepairWithOrderedPrefix) {
        this.canRepairWithOrderedPrefix = false
        this.loadFullSource(windowOperationGeneration)
      } else {
        this.loadOrderedPrefixRepair(windowOperationGeneration)
      }
      return
    }
    const epoch = this.orderedPrefixRepairGeneration
    let hasSupersededAcquisition = true
    try {
      hasSupersededAcquisition = this.retireSuperseded(epoch)
    } finally {
      // A release callback may synchronously begin truncate replay. Keep the
      // repair ownership open so replay settlement can finish retiring the
      // remaining superseded leases without releasing the refreshed prefix.
      if (!this.active || !hasSupersededAcquisition) {
        this.coverageEpoch = epoch
        this.cancelRepairRetry()
        this.repairRetries = 0
        this.canRepairWithOrderedPrefix = false
        this.needsOrderingRepair = false
        this.authoritativeRequestState = `none`
        this.authoritativeRequestKind = undefined
        this.orderedPrefixRepairGeneration = undefined
      }
    }
  }

  private abandonOrderedPrefixRepair(): void {
    if (this.authoritativeRequestKind !== `ordered-repair`) return
    this.canRepairWithOrderedPrefix = false
    this.authoritativeRequestState = `none`
    this.authoritativeRequestKind = undefined
    this.orderedPrefixRepairGeneration = undefined
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
      (onLoadSubsetResult) => {
        this.subscription.requestLimitedSnapshot({
          ...(continuesOrderedPrefixRepair ? { refetch: true } : {}),
          orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
          limit: count,
          minValues,
          // Local rows seen before the first provider request prove neither
          // a cursor nor a remote offset. Start the first acquisition at zero.
          offset: startsFromSourcePrefix ? 0 : this.countAcquiredRows(),
          trackLoadSubsetPromise: false,
          onLoadSubsetResult,
        })
      },
      `ordered`,
      windowOperationGeneration,
      continuesOrderedPrefixRepair,
      count,
    )
  }

  private observe(
    result: LoadSubsetRequestResult,
    releaseAcquisition: ReleaseLoadSubset,
    kind: OrderedRequestKind,
    windowOperationGeneration?: number,
    options?: LoadSubsetOptions,
    continuesOrderedPrefixRepair = false,
    requestGraphInputRevision?: number,
    requestedCount?: number,
  ): Promise<void> | undefined {
    const isFullSource = kind === `full-source`
    const isOrderedRepair = kind === `ordered-repair`
    const isAuthoritativeRequest =
      isFullSource || isOrderedRepair || continuesOrderedPrefixRepair
    const retryRepair =
      isAuthoritativeRequest &&
      this.hasSettledSourceRequest &&
      this.needsOrderingRepair &&
      windowOperationGeneration === undefined
    const stamp: RequestStamp = {
      orderedLoadGeneration: this.orderedLoadGeneration,
      orderingInvalidationGeneration: this.orderingInvalidationGeneration,
      isAuthoritativeRequest,
    }
    const authorityGeneration = this.authorityGeneration
    const settlesAsync = result instanceof Promise
    const canSettleSynchronously =
      !settlesAsync &&
      windowOperationGeneration === undefined &&
      // A full-source request without ordering-repair debt can finish in the
      // current graph turn, including an initial fallback. A bounded prefix
      // repair reads only installed rows and can also finish in that turn.
      // Other repairs keep asynchronous settlement.
      (!isAuthoritativeRequest ||
        (isFullSource ? !this.needsOrderingRepair : this.readsBoundedPrefix)) &&
      requestGraphInputRevision !== undefined
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
      // Retirement failure does not undo a successful acquisition. Finish its
      // boundary and continuation, then report the first cleanup error.
      runAllCallbacks([
        () => {
          if (!isFullSource) {
            // A replay can replace the acquisition lease while this older
            // transport finishes. Retire its logical owner only outside the
            // replay barrier.
            const prefixCount =
              options?.orderBy && !options.cursor ? options.limit : undefined
            this.settledFiniteAcquisitions.set(releaseAcquisition, {
              count: prefixCount,
              epoch: stamp.orderingInvalidationGeneration,
            })
            if (!continuesOrderedPrefixRepair) {
              this.retireSettledFiniteAcquisitions()
            }
            // A prefix issued before an ordering invalidation proves no
            // current coverage, so it cannot supersede the repair's prefix.
            if (
              !continuesOrderedPrefixRepair &&
              this.standing(stamp) === `current` &&
              prefixCount !== undefined
            ) {
              this.retireSettledFiniteAcquisitions({
                release: releaseAcquisition,
                count: prefixCount,
              })
            }
            // A request issued before an ordering invalidation that settles
            // after the repair finished is already superseded by that repair.
            if (
              this.standing(stamp) === `stale` &&
              this.authoritativeRequestState === `none` &&
              !this.needsOrderingRepair &&
              this.coverageEpoch !== undefined
            ) {
              this.retireSuperseded(this.coverageEpoch)
            }
          }
        },
        () => {
          if (this.standing(stamp) !== `current`) return
          // A finite request may finish behind an authoritative repair. It cannot
          // clear that repair's failure or resume finite refinement around it.
          if (
            !isAuthoritativeRequest &&
            (this.failedRequest || this.authoritativeRequestState !== `none`)
          )
            return
          this.failedRequest = undefined
          if (kind !== `boundary`) {
            this.hasSettledSourceRequest = true
            // Source delivery can invalidate the in-flight prefix marker.
            if (options?.orderBy && !options.cursor) {
              this.lastPrefixCount = options.limit
            }
            if (!isFullSource && options?.orderBy) {
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
            this.orderedPrefixRepairGeneration !==
              this.orderingInvalidationGeneration
          ) {
            // The settled request may apply its rows, but a later mutation has
            // already invalidated this chain. Replace it before issuing stale
            // tie or refill work.
            this.finishOrderedPrefixRepair(windowOperationGeneration)
            return
          }
          if (isFullSource) {
            this.cancelRepairRetry()
            this.repairRetries = 0
            this.canRepairWithOrderedPrefix = false
            this.needsOrderingRepair = false
            this.authoritativeRequestState = `complete`
            this.authoritativeRequestKind = undefined
            this.orderedPrefixRepairGeneration = undefined
            this.retireSettledFiniteAcquisitions()
          }
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
      this.settledFiniteAcquisitions.delete(releaseAcquisition)
      this.stagedContinuation = undefined
      if (trackedRequest && this.pending === trackedRequest) {
        this.pending = undefined
      }
      if (!this.active) return
      // A failed request may already have written only part of its result.
      // None of those rows is a safe continuation boundary.
      this.requireFullSourceRepair()
      if (this.standing(stamp) === `dead`) return
      // Authoritative work started after this request supersedes it. Its
      // failure is not the loader's own: its partial writes only raise the
      // debt to the full-source read that the overlap replaced. A running
      // repair restarts as that read; otherwise it starts now, unless the
      // loader's own failure is waiting for an explicit retry.
      if (
        !isAuthoritativeRequest &&
        authorityGeneration !== this.authorityGeneration
      ) {
        this.failedAcquisitions.set(releaseAcquisition, kind)
        this.invalidateCursor()
        this.lastBoundary = undefined
        // The loader's own recorded failure still waits for an explicit retry.
        if (
          this.failedRequest === undefined &&
          this.authoritativeRequestState === `none`
        ) {
          this.loadFullSource(windowOperationGeneration)
        }
        throw error
      }
      // A failed request proves no full-source coverage. An explicit window
      // move or later replay may retry it, but an ordinary graph pass must
      // not start an eager retry loop.
      if (isAuthoritativeRequest) {
        if (isFullSource) {
          this.authoritativeRequestState = `failed`
        } else {
          this.authoritativeRequestState = `none`
          this.authoritativeRequestKind = undefined
          this.orderedPrefixRepairGeneration = undefined
        }
      }
      this.recordRequestFailure(windowOperationGeneration)
      this.failedAcquisitions.set(releaseAcquisition, kind)
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
              this.graphHasProcessedInput(requestGraphInputRevision)
            ) {
              this.drainNoInputContinuations(requestGraphInputRevision)
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
    const request: Promise<void> = settlesAsync ? result : Promise.resolve()
    const tracked: Promise<void> = request.then(
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
  }

  // A result is dead after a cursor reset. A non-authoritative result is stale
  // after an ordering invalidation: it proves no current coverage.
  private standing(stamp: RequestStamp): `dead` | `stale` | `current` {
    if (stamp.orderedLoadGeneration !== this.orderedLoadGeneration)
      return `dead`
    return !stamp.isAuthoritativeRequest &&
      stamp.orderingInvalidationGeneration !==
        this.orderingInvalidationGeneration
      ? `stale`
      : `current`
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
      (onLoadSubsetResult) => {
        this.subscription.requestSnapshot({
          ...(continuesOrderedPrefixRepair ? { refetch: true } : {}),
          where,
          trackLoadSubsetPromise: false,
          onLoadSubsetResult,
        })
      },
      `boundary`,
      windowOperationGeneration,
      continuesOrderedPrefixRepair,
    )
  }

  private requireFullSourceRepair(): void {
    this.settledSourceBoundary = undefined
    this.canRepairWithOrderedPrefix = false
    this.orderedPrefixRepairGeneration = undefined
    this.needsOrderingRepair = true
  }

  private cancelRepairRetry(): void {
    clearTimeout(this.repairTimer)
    this.repairTimer = undefined
  }

  private releaseFailedAcquisitions(): void {
    const failed = this.failedAcquisitions
    this.failedAcquisitions = new Map()
    this.requesting = true
    try {
      runAllCallbacks(failed.keys())
    } finally {
      this.requesting = false
    }
  }

  private scheduleRepairRetry(): void {
    if (
      !this.active ||
      !this.canRetryRepair() ||
      this.repairTimer !== undefined ||
      this.repairRetries >= 2
    )
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
            this.failedRequest !== failedRequest ||
            this.failedRequest?.windowOperationGeneration !== undefined
          )
            return
          this.releaseFailedAcquisitions()
          // Release may dispose or start a new replay; neither belongs to this retry.
          if (
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- release callbacks can dispose the loader
            !this.active ||
            orderedLoadGeneration !== this.orderedLoadGeneration ||
            this.subscription.hasPendingTruncateReplacement
          )
            return
          this.failedRequest = undefined
          this.authoritativeRequestState = `none`
          this.loadFullSource()
        })
        void retry.catch(() => {})
        this.onResult(retry, true, true)
      },
      250 * 2 ** this.repairRetries++,
    )
  }

  private failRequest(
    observed:
      | {
          result: LoadSubsetRequestResult
          options: LoadSubsetOptions
          release: ReleaseLoadSubset
        }
      | undefined,
    error: Error,
    isAuthoritativeRequest: boolean,
    windowOperationGeneration?: number,
    cancelObservedSettlement = false,
  ): Error {
    if (cancelObservedSettlement) {
      this.orderedLoadGeneration++
      this.pending = undefined
    }
    this.requireFullSourceRepair()
    this.recordRequestFailure(windowOperationGeneration)
    if (isAuthoritativeRequest) {
      this.authoritativeRequestState = `none`
      this.authoritativeRequestKind = undefined
    }
    try {
      observed?.release({ error })
    } catch {
      // Cleanup is attempted once and must not replace the request failure.
    }
    if (
      isAuthoritativeRequest &&
      this.hasSettledSourceRequest &&
      windowOperationGeneration === undefined
    ) {
      this.scheduleRepairRetry()
    }
    return error
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
    request: (
      onResult: (
        result: LoadSubsetRequestResult,
        options: LoadSubsetOptions,
        release: ReleaseLoadSubset,
      ) => void,
    ) => void,
    kind: OrderedRequestKind,
    windowOperationGeneration?: number,
    continuesOrderedPrefixRepair = false,
    requestedCount?: number,
  ): Promise<void> | undefined {
    const isFullSource = kind === `full-source`
    const isAuthoritativeRequest =
      isFullSource || kind === `ordered-repair` || continuesOrderedPrefixRepair
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
    try {
      try {
        request((result, options, release) => {
          observed = { result, options, release }
        })
      } finally {
        this.requesting = false
      }
      if (!observed) return
      observing = true
      return this.observe(
        observed.result,
        observed.release,
        kind,
        windowOperationGeneration,
        observed.options,
        continuesOrderedPrefixRepair,
        graphInputRevision,
        requestedCount,
      )
    } catch (error) {
      if (error instanceof OrderedPostSettlementError) throw error.cause
      // Both request and settlement callbacks may reenter through cleanup.
      // Keep refinement blocked until failure and release finish unwinding.
      this.requesting = true
      try {
        const failure = this.failRequest(
          observed,
          normalizeError(error),
          isAuthoritativeRequest,
          windowOperationGeneration,
          observing,
        )
        if (
          !observing &&
          isAuthoritativeRequest &&
          this.hasSettledSourceRequest
        ) {
          // A synchronous repair failure has no transport promise, but must
          // still close publication before the triggering graph turn returns.
          const rejected = Promise.reject(failure)
          void rejected.catch(() => {})
          this.onResult(rejected, true, true)
        }
        throw failure
      } finally {
        this.requesting = false
      }
    }
  }
}
