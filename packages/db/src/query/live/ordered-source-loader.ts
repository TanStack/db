import {
  buildCursorCurrent,
  canExpressCursorOrder,
} from '../../utils/cursor.js'
import { normalizeError } from '../../utils/error.js'
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

type OrderedRequestKind = `ordered` | `boundary` | `full-source`

/** Owns the conservative provider-loading policy for one ordered source. */
export class OrderedSourceLoader {
  private pending: Promise<unknown> | undefined
  // Exact request settlement is not provider extent. Reset may discard its
  // boundary without undoing settlement; an empty page retains the boundary.
  private hasSettledSourceRequest = false
  private settledSourceBoundary: Record<string, unknown> | undefined
  // Independent of finite success: only full-source success repairs ordering.
  private needsFullSourceRecovery = false
  private requesting = false
  // Retaining a demand does not prove it succeeded. Async failure retains it
  // for replay; a synchronous startup failure does not.
  private hasFullSourceDemand = false
  private fullSourceFailed = false
  // The record's presence blocks automatic retry, including initial requests
  // that have no explicit window-operation generation.
  private failedRequest:
    | { windowOperationGeneration: number | undefined }
    | undefined
  private releaseFailedAcquisition: ReleaseLoadSubset | undefined
  private active = true
  private generation = 0
  private lastPage: { count: number; boundary: unknown } | undefined
  private lastPrefixCount: number | undefined
  private lastBoundary: unknown

  constructor(
    private readonly info: OrderByOptimizationInfo,
    private readonly subscription: CollectionSubscription,
    private readonly alias: string,
    private readonly onResult: (
      result: LoadSubsetRequestResult,
      holdPublication: boolean,
    ) => void = () => {},
  ) {
    this.info.isRequesting = () => this.requesting
  }

  get pendingPromise(): Promise<unknown> | undefined {
    return this.pending
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

  loadMore(windowOperationGeneration?: number): Promise<unknown> | undefined {
    if (!this.active || this.info.limit === 0 || this.requesting) return
    const mayRetryFailure =
      this.failedRequest === undefined ||
      (windowOperationGeneration !== undefined &&
        windowOperationGeneration !==
          this.failedRequest.windowOperationGeneration)
    if (!mayRetryFailure) return this.pending
    if (
      (this.failedRequest || this.releaseFailedAcquisition) &&
      windowOperationGeneration !== undefined
    ) {
      // Move ownership to the explicit replacement before releasing the old
      // lease. Adapter cleanup may reenter the loader.
      if (this.failedRequest) {
        this.failedRequest.windowOperationGeneration = windowOperationGeneration
      }
      const releaseFailedAcquisition = this.releaseFailedAcquisition
      this.releaseFailedAcquisition = undefined
      if (releaseFailedAcquisition) {
        this.requesting = true
        try {
          releaseFailedAcquisition()
        } finally {
          this.requesting = false
        }
        // Adapter cleanup can synchronously tear down this loader.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!this.active) return
      }
    }
    if (this.fullSourceFailed) {
      this.hasFullSourceDemand = false
      this.fullSourceFailed = false
    }
    if (this.hasFullSourceDemand) return this.pending
    if (this.needsFullSourceRecovery || this.info.requiresFullSource) {
      this.loadFullSource(windowOperationGeneration)
      return this.pending
    }
    if (!this.info.index || this.info.orderBy.length !== 1) {
      this.loadPrefix(
        this.info.offset + this.info.limit,
        windowOperationGeneration,
      )
      return this.pending
    }
    if (!this.info.dataNeeded) return this.pending
    let count = Math.max(
      this.info.dataNeeded(),
      this.failedRequest !== undefined || !this.hasSettledSourceRequest
        ? this.info.offset + this.info.limit
        : 0,
    )
    if (this.pending) return this.pending
    if (
      windowOperationGeneration !== undefined &&
      this.settledSourceBoundary !== undefined
    ) {
      const needed = this.info.offset + this.info.limit
      count = Math.max(count, needed - this.countAcquiredRows())
    }
    if (count > 0) {
      this.loadPage(count, windowOperationGeneration)
    }
    return this.pending
  }

  loadFullSource(windowOperationGeneration?: number): void {
    if (!this.active || this.hasFullSourceDemand) return
    this.fullSourceFailed = false
    this.hasFullSourceDemand = true
    this.requestAndObserve(
      (onLoadSubsetResult) => {
        this.subscription.requestSnapshot({
          trackLoadSubsetPromise: false,
          onLoadSubsetResult,
        })
      },
      `full-source`,
      windowOperationGeneration,
    )
  }

  private loadPrefix(count: number, windowOperationGeneration?: number): void {
    if (!this.active || this.pending) return
    if (this.lastPrefixCount === count) {
      if ((this.info.dataNeeded?.() ?? 0) > 0) {
        this.loadFullSource(windowOperationGeneration)
      }
      return
    }
    this.requestAndObserve(
      (onLoadSubsetResult) => {
        this.subscription.requestSnapshot({
          orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
          limit: count,
          trackLoadSubsetPromise: false,
          onLoadSubsetResult,
        })
      },
      `ordered`,
      windowOperationGeneration,
    )
    this.lastPrefixCount = count
  }

  resetCursor(): void {
    this.generation++
    this.pending = undefined
    this.lastBoundary = undefined
    this.settledSourceBoundary = undefined
    this.invalidateCursor()
  }

  settleFullSourceReplay(): void {
    if (this.hasFullSourceDemand) this.fullSourceFailed = false
  }

  invalidateCursor(): void {
    this.lastPage = undefined
    this.lastPrefixCount = undefined
  }

  invalidateSourceOrdering(): void {
    this.invalidateCursor()
    this.requireFullSourceRecovery()
  }

  dispose(): void {
    this.active = false
    this.resetCursor()
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

  private loadPage(count: number, windowOperationGeneration?: number): void {
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
    )
  }

  private observe(
    result: LoadSubsetRequestResult,
    releaseAcquisition: ReleaseLoadSubset,
    kind: OrderedRequestKind,
    windowOperationGeneration?: number,
    options?: LoadSubsetOptions,
  ): Promise<void> {
    const isFullSource = kind === `full-source`
    const generation = this.generation
    const complete = (): void => {
      if (this.pending === tracked) this.pending = undefined
      if (!this.active || generation !== this.generation) return
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
              this.subscription.readOrderedSnapshot(options).at(-1)?.value ??
              this.settledSourceBoundary
          } catch (error) {
            fail(error)
          }
        }
      }
      if (isFullSource) {
        this.fullSourceFailed = false
        this.needsFullSourceRecovery = false
      }
      if (kind === `ordered`) {
        this.loadBoundary(windowOperationGeneration)
        return
      }
      // A boundary request may add tied rows without filling the query's
      // window. Resume forward loading once it settles.
      this.loadMore()
    }
    const settlesAsync = result instanceof Promise
    const request = settlesAsync ? result : Promise.resolve()
    const fail = (error: unknown) => {
      if (this.pending === tracked) this.pending = undefined
      if (!this.active) return
      // A failed request may already have written only part of its result.
      // None of those rows is a safe continuation boundary.
      this.requireFullSourceRecovery()
      if (generation !== this.generation) return
      if (isFullSource) {
        // A failed request proves no full-source coverage. An explicit
        // window move or later replay may retry it, but an ordinary graph
        // pass must not start an eager retry loop.
        this.fullSourceFailed = true
      }
      this.recordRequestFailure(windowOperationGeneration)
      this.releaseFailedAcquisition = releaseAcquisition
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
      settlesAsync && isFullSource && this.needsFullSourceRecovery,
    )
    return tracked
  }

  private loadBoundary(
    windowOperationGeneration?: number,
  ): Promise<unknown> | undefined {
    const biggest = this.settledSourceBoundary
    if (biggest === undefined) return
    const value = this.info.valueExtractorForRawRow(biggest)
    const orderBy = normalizeOrderByPaths(this.info.orderBy, this.alias)
    if (!canExpressCursorOrder(orderBy.slice(0, 1), [value])) {
      this.loadFullSource(windowOperationGeneration)
      return this.pending
    }
    // Undefined is not an expressible cursor boundary, so it denotes that no
    // tie request has been attempted. Other falsy values remain valid keys.
    if (Object.is(this.lastBoundary, value)) {
      return this.loadMore()
    }
    const where = buildCursorCurrent(orderBy, [value])
    if (!where) {
      this.loadFullSource(windowOperationGeneration)
      return this.pending
    }
    this.lastBoundary = value
    return this.requestAndObserve(
      (onLoadSubsetResult) => {
        this.subscription.requestSnapshot({
          where,
          trackLoadSubsetPromise: false,
          onLoadSubsetResult,
        })
      },
      `boundary`,
      windowOperationGeneration,
    )
  }

  private requireFullSourceRecovery(): void {
    this.hasSettledSourceRequest = false
    this.settledSourceBoundary = undefined
    this.needsFullSourceRecovery = true
  }

  private retireProvisionalFailure(
    observed: {
      result: LoadSubsetRequestResult
      options: LoadSubsetOptions
      release: ReleaseLoadSubset
    },
    error: unknown,
    isFullSource: boolean,
    windowOperationGeneration?: number,
    cancelObservedSettlement = false,
  ): void {
    if (cancelObservedSettlement) {
      this.generation++
      this.pending = undefined
    }
    this.failSynchronousRequest(isFullSource, windowOperationGeneration)
    try {
      observed.release({ error })
    } catch {
      // releaseLoadSubset retains cleanup debt for a later retry.
    }
  }

  private failSynchronousRequest(
    isFullSource: boolean,
    windowOperationGeneration?: number,
  ): void {
    this.requireFullSourceRecovery()
    this.recordRequestFailure(windowOperationGeneration)
    if (isFullSource) {
      this.hasFullSourceDemand = false
      this.fullSourceFailed = true
    }
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
        release?: ReleaseLoadSubset,
      ) => void,
    ) => void,
    kind: OrderedRequestKind,
    windowOperationGeneration?: number,
  ): Promise<void> | undefined {
    const isFullSource = kind === `full-source`
    let observed:
      | {
          result: LoadSubsetRequestResult
          options: LoadSubsetOptions
          release: ReleaseLoadSubset
        }
      | undefined
    this.requesting = true
    try {
      request((result, options, release) => {
        observed = {
          result,
          options,
          release:
            release ??
            ((primaryFailure) =>
              this.subscription.releaseLoadSubset(options, primaryFailure)),
        }
      })
    } catch (error) {
      const normalized = normalizeError(error)
      // Enter failure state before adapter cleanup. Releasing the provisional
      // acquisition may call back into the graph, but it cannot start a
      // replacement while the failed request is still unwinding.
      // The acquisition began, but later synchronous snapshot or publication
      // work failed. Retire it without replacing the original failure.
      if (observed) {
        this.retireProvisionalFailure(
          observed,
          normalized,
          isFullSource,
          windowOperationGeneration,
        )
      } else {
        this.failSynchronousRequest(isFullSource, windowOperationGeneration)
      }
      throw normalized
    } finally {
      this.requesting = false
    }
    if (!observed) return
    try {
      return this.observe(
        observed.result,
        observed.release,
        kind,
        windowOperationGeneration,
        observed.options,
      )
    } catch (error) {
      const normalized = normalizeError(error)
      this.requesting = true
      try {
        this.retireProvisionalFailure(
          observed,
          normalized,
          isFullSource,
          windowOperationGeneration,
          true,
        )
      } finally {
        this.requesting = false
      }
      throw normalized
    }
  }
}
