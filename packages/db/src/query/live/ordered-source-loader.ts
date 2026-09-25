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
  | `ordered`
  | `ordered-repair`
  | `boundary`
  | `full-source`

/** Owns the conservative provider-loading policy for one ordered source. */
export class OrderedSourceLoader {
  private pending: Promise<unknown> | undefined
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
  private settledFiniteAcquisitions = new Map<
    ReleaseLoadSubset,
    number | undefined
  >()
  private orderedRepairAcquisitions = new Set<ReleaseLoadSubset>()
  // The record's presence blocks automatic retry, including initial requests
  // that have no explicit window-operation generation.
  private failedRequest:
    | { windowOperationGeneration: number | undefined }
    | undefined
  private failedAcquisitions = new Map<ReleaseLoadSubset, OrderedRequestKind>()
  private active = true
  private orderedLoadGeneration = 0
  private orderingInvalidationGeneration = 0
  private orderedPrefixRepairGeneration: number | undefined
  private lastPage: { count: number; boundary: unknown } | undefined
  private lastPrefixCount: number | undefined
  private lastBoundary: unknown
  private repairRetries = 0
  private repairTimer: ReturnType<typeof setTimeout> | undefined

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
  ) {
    this.info.isRequesting = () => this.requesting
  }

  /** Derive invalidation from actual contributions, not a second cursor. */
  onSourceChanges(
    changes: Array<ChangeMessage<Record<string, unknown>, string | number>>,
    sentRows: ReadonlyMap<string | number, Record<string, unknown>> | undefined,
  ): void {
    let hasNewRows = false
    for (const change of changes) {
      const previous = sentRows?.get(change.key)
      if (
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
    // New keys, including ties, may need another page. Duplicate delivery or
    // an order-equal update cannot invalidate an already attempted request.
    if (hasNewRows) this.invalidateCursor()
  }

  start(): void {
    const { index, limit, offset, orderBy, requiresFullSource } = this.info
    if (index) this.subscription.setOrderByIndex(index)
    if (limit === 0) return
    if (requiresFullSource) {
      this.loadFullSource()
      return
    }
    if (!index || orderBy.length !== 1) {
      this.loadPrefix(offset + limit)
      return
    }
    this.loadPage(offset + limit)
  }

  loadMore(
    windowOperationGeneration?: number,
    continuesOrderedPrefixRepair = false,
  ): Promise<unknown> | undefined {
    if (!this.active || this.info.limit === 0 || this.requesting) return
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
    )
      return this.pending
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
    if (!this.info.index || this.info.orderBy.length !== 1) {
      const shouldLoad =
        windowOperationGeneration !== undefined ||
        (this.info.dataNeeded?.() ?? 0) > 0 ||
        (this.lastPrefixCount !== undefined &&
          this.lastPrefixCount < this.info.offset + this.info.limit)
      if (shouldLoad) {
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
      if (continuesOrderedPrefixRepair && !this.pending) {
        this.finishOrderedPrefixRepair(windowOperationGeneration)
      }
      return this.pending
    }
    // A recorded failure always carries repair debt, so it cannot reach this
    // finite path; only the first request needs the whole prefix here.
    let count = Math.max(
      this.info.dataNeeded(),
      this.hasSettledSourceRequest ? 0 : this.info.offset + this.info.limit,
    )
    if (
      windowOperationGeneration !== undefined &&
      this.settledSourceBoundary !== undefined
    ) {
      const needed = this.info.offset + this.info.limit
      count = Math.max(count, needed - this.countAcquiredRows())
    }
    if (count > 0) {
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
    // Any older finite request may still settle, but it cannot refine from a
    // boundary that predates this authoritative prefix.
    this.orderedPrefixRepairGeneration = this.orderingInvalidationGeneration
    this.orderedRepairAcquisitions = new Set()
    this.authoritativeRequestState = `held`
    this.authoritativeRequestKind = `ordered-repair`
    this.requestAndObserve(
      (onLoadSubsetResult) => {
        this.subscription.requestSnapshot({
          refetch: true,
          orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
          limit: this.info.offset + this.info.limit,
          trackLoadSubsetPromise: false,
          onLoadSubsetResult,
        })
      },
      `ordered-repair`,
      windowOperationGeneration,
      true,
    )
  }

  private loadPrefix(
    count: number,
    windowOperationGeneration?: number,
    continuesOrderedPrefixRepair = false,
  ): void {
    if (!this.active || this.pending) return
    if (this.lastPrefixCount === count) {
      if ((this.info.dataNeeded?.() ?? 0) > 0) {
        if (continuesOrderedPrefixRepair) this.abandonOrderedPrefixRepair()
        this.loadFullSource(windowOperationGeneration)
      }
      return
    }
    this.requestAndObserve(
      (onLoadSubsetResult) => {
        this.subscription.requestSnapshot({
          ...(continuesOrderedPrefixRepair ? { refetch: true } : {}),
          orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
          limit: count,
          trackLoadSubsetPromise: false,
          onLoadSubsetResult,
        })
      },
      `ordered`,
      windowOperationGeneration,
      continuesOrderedPrefixRepair,
    )
    this.lastPrefixCount = count
  }

  resetCursor(): void {
    this.cancelRepairRetry()
    this.repairRetries = 0
    this.orderedLoadGeneration++
    if (this.authoritativeRequestState === `complete`)
      this.authoritativeRequestState = `held`
    this.pending = undefined
    this.lastBoundary = undefined
    this.settledSourceBoundary = undefined
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
    retained?: ReadonlySet<ReleaseLoadSubset>,
  ): void {
    if (
      (this.authoritativeRequestState !== `complete` && !prefix && !retained) ||
      this.subscription.hasPendingTruncateReplacement
    )
      return
    const orderedLoadGeneration = this.orderedLoadGeneration
    runAllCallbacks(
      Array.from(this.settledFiniteAcquisitions, ([release, count]) => () => {
        if (retained?.has(release)) return
        if (
          !this.active ||
          orderedLoadGeneration !== this.orderedLoadGeneration
        )
          return
        if (
          this.authoritativeRequestState !== `complete` &&
          !retained &&
          (!prefix ||
            release === prefix.release ||
            count === undefined ||
            count > prefix.count)
        )
          return
        this.settledFiniteAcquisitions.delete(release)
        release()
      }),
    )
  }

  invalidateCursor(): void {
    this.lastPage = undefined
    this.lastPrefixCount = undefined
  }

  invalidateSourceOrdering(): void {
    this.orderingInvalidationGeneration++
    this.invalidateCursor()
    this.lastBoundary = undefined
    if (
      !this.needsOrderingRepair &&
      this.hasSettledSourceRequest &&
      this.pending === undefined &&
      this.authoritativeRequestState === `none`
    ) {
      this.canRepairWithOrderedPrefix = true
    }
    this.settledSourceBoundary = undefined
    this.needsOrderingRepair = true
  }

  private finishOrderedPrefixRepair(windowOperationGeneration?: number): void {
    if (this.authoritativeRequestKind !== `ordered-repair`) return
    if (
      this.orderedPrefixRepairGeneration !== this.orderingInvalidationGeneration
    ) {
      // A later mutation invalidated the source order while this chain was
      // running. Start its replacement before the current participant settles
      // so Collection and Effect publication remain behind one continuous gate.
      this.orderedRepairAcquisitions = new Set()
      this.authoritativeRequestState = `none`
      this.authoritativeRequestKind = undefined
      this.orderedPrefixRepairGeneration = undefined
      if (!this.active) return
      if (this.failedRequest) {
        this.canRepairWithOrderedPrefix = false
        this.loadFullSource(windowOperationGeneration)
      } else {
        this.canRepairWithOrderedPrefix = true
        this.loadOrderedPrefixRepair(windowOperationGeneration)
      }
      return
    }
    const retained = this.orderedRepairAcquisitions
    try {
      this.retireSettledFiniteAcquisitions(undefined, retained)
    } finally {
      const hasSupersededAcquisition = [
        ...this.settledFiniteAcquisitions.keys(),
      ].some((release) => !retained.has(release))
      // A release callback may synchronously begin truncate replay. Keep the
      // repair ownership open so replay settlement can finish retiring the
      // remaining superseded leases without releasing the refreshed prefix.
      if (!this.active || !hasSupersededAcquisition) {
        this.orderedRepairAcquisitions = new Set()
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
    this.orderedRepairAcquisitions = new Set()
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
    if (!this.active || this.pending) return
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
      return
    }
    this.lastPage = { count, boundary }
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
    )
  }

  private observe(
    result: LoadSubsetRequestResult,
    releaseAcquisition: ReleaseLoadSubset,
    kind: OrderedRequestKind,
    windowOperationGeneration?: number,
    options?: LoadSubsetOptions,
    continuesOrderedPrefixRepair = false,
  ): Promise<void> {
    const isFullSource = kind === `full-source`
    const isOrderedRepair = kind === `ordered-repair`
    const isAuthoritativeRepair =
      isFullSource || isOrderedRepair || continuesOrderedPrefixRepair
    const retryRepair =
      isAuthoritativeRepair &&
      this.hasSettledSourceRequest &&
      this.needsOrderingRepair &&
      windowOperationGeneration === undefined
    const orderedLoadGeneration = this.orderedLoadGeneration
    const orderingInvalidationGeneration = this.orderingInvalidationGeneration
    const complete = (): void => {
      if (this.pending === tracked) this.pending = undefined
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
            this.settledFiniteAcquisitions.set(releaseAcquisition, prefixCount)
            if (isOrderedRepair || continuesOrderedPrefixRepair) {
              this.orderedRepairAcquisitions.add(releaseAcquisition)
            }
            if (!continuesOrderedPrefixRepair) {
              this.retireSettledFiniteAcquisitions()
            }
            if (
              !continuesOrderedPrefixRepair &&
              orderedLoadGeneration === this.orderedLoadGeneration &&
              prefixCount !== undefined
            ) {
              this.retireSettledFiniteAcquisitions({
                release: releaseAcquisition,
                count: prefixCount,
              })
            }
          }
        },
        () => {
          if (orderedLoadGeneration !== this.orderedLoadGeneration) return
          if (
            !isAuthoritativeRepair &&
            orderingInvalidationGeneration !==
              this.orderingInvalidationGeneration
          )
            return
          // A finite request may finish behind an authoritative repair. It cannot
          // clear that repair's failure or resume finite refinement around it.
          if (
            !isAuthoritativeRepair &&
            (this.failedRequest || this.authoritativeRequestState !== `none`)
          )
            return
          // If an older overlapping request failed, its unknown partial
          // writes upgrade the debt to a full-source repair. The ordered
          // prefix must not erase that failure merely because it settled
          // later.
          if (
            (isOrderedRepair || continuesOrderedPrefixRepair) &&
            this.failedRequest
          ) {
            this.abandonOrderedPrefixRepair()
            return
          }
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
                  this.subscription.readOrderedSnapshot(options).at(-1)
                    ?.value ?? this.settledSourceBoundary
              } catch (error) {
                fail(error)
              }
            }
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
          if (isOrderedRepair) {
            this.loadBoundary(windowOperationGeneration, true)
            return
          }
          if (kind === `ordered`) {
            this.loadBoundary(
              windowOperationGeneration,
              continuesOrderedPrefixRepair,
            )
            return
          }
          // A boundary request may add tied rows without filling the query's
          // window. Resume forward loading once it settles.
          this.loadMore(windowOperationGeneration, continuesOrderedPrefixRepair)
        },
      ])
    }
    const settlesAsync = result instanceof Promise
    const request = settlesAsync ? result : Promise.resolve()
    const fail = (error: unknown) => {
      this.settledFiniteAcquisitions.delete(releaseAcquisition)
      if (this.pending === tracked) this.pending = undefined
      if (!this.active) return
      // A failed request may already have written only part of its result.
      // None of those rows is a safe continuation boundary.
      this.requireFullSourceRepair()
      if (orderedLoadGeneration !== this.orderedLoadGeneration) return
      // A failed request proves no full-source coverage. An explicit window
      // move or later replay may retry it, but an ordinary graph pass must
      // not start an eager retry loop.
      if (isAuthoritativeRepair) {
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
    const tracked = request.then(complete, fail)
    this.pending = tracked
    void tracked.catch(() => {})
    // Register each request separately. The operation tracker observes the
    // next request before this promise settles, so the logical chain remains
    // pending without retaining every ancestor promise until the final page.
    this.onResult(
      tracked,
      isAuthoritativeRepair && this.needsOrderingRepair,
      settlesAsync,
    )
    return tracked
  }

  private loadBoundary(
    windowOperationGeneration?: number,
    continuesOrderedPrefixRepair = false,
  ): Promise<unknown> | undefined {
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
    this.orderedRepairAcquisitions.clear()
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
    isAuthoritativeRepair: boolean,
    windowOperationGeneration?: number,
    cancelObservedSettlement = false,
  ): Error {
    if (cancelObservedSettlement) {
      this.orderedLoadGeneration++
      this.pending = undefined
    }
    this.requireFullSourceRepair()
    this.recordRequestFailure(windowOperationGeneration)
    if (isAuthoritativeRepair) {
      this.authoritativeRequestState = `none`
      this.authoritativeRequestKind = undefined
    }
    try {
      observed?.release({ error })
    } catch {
      // Cleanup is attempted once and must not replace the request failure.
    }
    if (
      isAuthoritativeRepair &&
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
  ): Promise<void> | undefined {
    const isFullSource = kind === `full-source`
    const isAuthoritativeRepair =
      isFullSource || kind === `ordered-repair` || continuesOrderedPrefixRepair
    let observed:
      | {
          result: LoadSubsetRequestResult
          options: LoadSubsetOptions
          release: ReleaseLoadSubset
        }
      | undefined
    this.requesting = true
    let observing = false
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
      )
    } catch (error) {
      // Both request and settlement callbacks may reenter through cleanup.
      // Keep refinement blocked until failure and release finish unwinding.
      this.requesting = true
      try {
        const failure = this.failRequest(
          observed,
          normalizeError(error),
          isAuthoritativeRepair,
          windowOperationGeneration,
          observing,
        )
        if (
          !observing &&
          isAuthoritativeRepair &&
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
