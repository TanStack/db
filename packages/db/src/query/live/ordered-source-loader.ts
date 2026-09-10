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

type OrderedRequestKind = `ordered` | `boundary` | `full-source`

/** Owns the conservative provider-loading policy for one ordered source. */
export class OrderedSourceLoader {
  private pending: Promise<unknown> | undefined
  // Exact request settlement is not provider extent. This latch only records
  // that some request once completed; reset may discard the boundary, and an
  // empty page retains it. A failure never reads it before a full-source
  // completion sets it again, so it never needs clearing.
  private hasSettledSourceRequest = false
  private settledSourceBoundary: Record<string, unknown> | undefined
  // Independent of finite success: only full-source success repairs ordering.
  private needsFullSourceRecovery = false
  private requesting = false
  // Retaining a demand does not prove it succeeded. Async failure retains it
  // (`failed`) for replay; a synchronous startup failure retains nothing.
  private fullSource: `none` | `held` | `complete` | `failed` = `none`
  // Keep callbacks, not copied requests or rows. Successful full-source work
  // subsumes these logical owners; unfinished transports remain observed.
  private settledFiniteAcquisitions = new Set<ReleaseLoadSubset>()
  // The record's presence blocks automatic retry, including initial requests
  // that have no explicit window-operation generation.
  private failedRequest:
    | { windowOperationGeneration: number | undefined }
    | undefined
  private failedAcquisitions = new Map<ReleaseLoadSubset, OrderedRequestKind>()
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
      (this.failedRequest || this.failedAcquisitions.size > 0) &&
      windowOperationGeneration !== undefined
    ) {
      // Move ownership to the explicit replacement before releasing the old
      // lease. Adapter cleanup may reenter the loader.
      if (this.failedRequest) {
        this.failedRequest.windowOperationGeneration = windowOperationGeneration
      }
      const failedAcquisitions = this.failedAcquisitions
      this.failedAcquisitions = new Map()
      if (failedAcquisitions.size > 0) {
        this.requesting = true
        try {
          runAllCallbacks(failedAcquisitions.keys())
        } finally {
          this.requesting = false
        }
        // Adapter cleanup can synchronously tear down this loader.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!this.active) return
      }
    }
    if (this.fullSource === `failed`) this.fullSource = `none`
    else if (this.fullSource !== `none`) return this.pending
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
    if (!this.info.dataNeeded || this.pending) return this.pending
    // A recorded failure always carries recovery debt, so it cannot reach this
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
      this.loadPage(count, windowOperationGeneration)
    }
    return this.pending
  }

  loadFullSource(windowOperationGeneration?: number): void {
    if (!this.active || this.fullSource !== `none`) return
    this.fullSource = `held`
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
    if (this.fullSource === `complete`) this.fullSource = `held`
    this.pending = undefined
    this.lastBoundary = undefined
    this.settledSourceBoundary = undefined
    this.invalidateCursor()
  }

  settleFullSourceReplay(): void {
    // Replay repaired the retained logical acquisition. A later window retry
    // must not release that now-successful source demand. A failed finite
    // page is still obsolete and must be released by that retry.
    if (this.fullSource === `failed`) {
      for (const [release, kind] of this.failedAcquisitions) {
        if (kind === `full-source`) this.failedAcquisitions.delete(release)
      }
      this.fullSource = `held`
    }
    if (this.fullSource !== `none`) {
      this.fullSource = `complete`
      this.retireSettledFiniteAcquisitions()
    }
  }

  private retireSettledFiniteAcquisitions(): void {
    if (
      this.fullSource !== `complete` ||
      this.subscription.hasPendingTruncateReplacement
    )
      return
    const generation = this.generation
    runAllCallbacks(
      Array.from(this.settledFiniteAcquisitions, (release) => () => {
        if (!this.active || generation !== this.generation) return
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
    this.invalidateCursor()
    this.requireFullSourceRecovery()
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
      if (!this.active) return
      if (!isFullSource) {
        // A replay can replace the physical lease while this older transport
        // finishes. Retire its logical owner only outside the replay barrier.
        this.settledFiniteAcquisitions.add(releaseAcquisition)
        this.retireSettledFiniteAcquisitions()
      }
      if (generation !== this.generation) return
      // A finite request may finish behind an authoritative repair. It cannot
      // clear that repair's failure or resume finite refinement around it.
      if (!isFullSource && (this.failedRequest || this.fullSource !== `none`))
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
              this.subscription.readOrderedSnapshot(options).at(-1)?.value ??
              this.settledSourceBoundary
          } catch (error) {
            fail(error)
          }
        }
      }
      if (isFullSource) {
        this.needsFullSourceRecovery = false
        this.fullSource = `complete`
        this.retireSettledFiniteAcquisitions()
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
      this.settledFiniteAcquisitions.delete(releaseAcquisition)
      if (this.pending === tracked) this.pending = undefined
      if (!this.active) return
      // A failed request may already have written only part of its result.
      // None of those rows is a safe continuation boundary.
      this.requireFullSourceRecovery()
      if (generation !== this.generation) return
      // A failed request proves no full-source coverage. An explicit window
      // move or later replay may retry it, but an ordinary graph pass must
      // not start an eager retry loop.
      if (isFullSource) this.fullSource = `failed`
      this.recordRequestFailure(windowOperationGeneration)
      this.failedAcquisitions.set(releaseAcquisition, kind)
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
    this.settledSourceBoundary = undefined
    this.needsFullSourceRecovery = true
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
    isFullSource: boolean,
    windowOperationGeneration?: number,
    cancelObservedSettlement = false,
  ): Error {
    if (cancelObservedSettlement) {
      this.generation++
      this.pending = undefined
    }
    this.requireFullSourceRecovery()
    this.recordRequestFailure(windowOperationGeneration)
    if (isFullSource) this.fullSource = `none`
    try {
      observed?.release({ error })
    } catch {
      // Cleanup is attempted once and must not replace the request failure.
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
      )
    } catch (error) {
      // Both request and settlement callbacks may reenter through cleanup.
      // Keep refinement blocked until failure and release finish unwinding.
      this.requesting = true
      try {
        throw this.failRequest(
          observed,
          normalizeError(error),
          isFullSource,
          windowOperationGeneration,
          observing,
        )
      } finally {
        this.requesting = false
      }
    }
  }
}
