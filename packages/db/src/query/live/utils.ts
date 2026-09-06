import { MultiSet } from '@tanstack/db-ivm'
import { UnsupportedRootScalarSelectError } from '../../errors.js'
import {
  buildCursorCurrent,
  canExpressCursorOrder,
} from '../../utils/cursor.js'
import { normalizeError } from '../../utils/error.js'
import { normalizeOrderByPaths } from '../compiler/expressions.js'
import { buildQuery, getQueryIR } from '../builder/index.js'
import { collectCollectionSources, isExpressionLike } from '../ir.js'
import type { MultiSetArray, RootStreamBuilder } from '@tanstack/db-ivm'
import type { Collection } from '../../collection/index.js'
import type {
  CollectionSubscription,
  ReleaseLoadSubset,
} from '../../collection/subscription.js'
import type {
  ChangeMessage,
  LoadSubsetOptions,
  LoadSubsetRequestResult,
} from '../../types.js'
import type { InitialQueryBuilder, QueryBuilder } from '../builder/index.js'
import type { Context } from '../builder/types.js'
import type { OrderBy, QueryIR } from '../ir.js'
import type { OrderByOptimizationInfo } from '../compiler/order-by.js'

/**
 * Helper function to extract collections from a compiled query.
 * Traverses the query IR to find all collection references.
 * Maps collections by their ID (not alias) as expected by the compiler.
 */
export function extractCollectionsFromQuery(
  query: QueryIR,
): Record<string, Collection<any, any, any>> {
  const collections: Record<string, Collection<any, any, any>> = {}
  for (const source of collectCollectionSources(query)) {
    collections[source.collection.id] = source.collection
  }
  return collections
}

export { collectCollectionSources as extractCollectionSources }

/**
 * Helper function to extract the collection that is referenced in the query's FROM clause.
 * The FROM clause may refer directly to a collection or indirectly to a subquery.
 */
export function extractCollectionFromSource(
  query: any,
): Collection<any, any, any> {
  const from = query.from

  if (from.type === `collectionRef`) {
    return from.collection
  } else if (from.type === `queryRef`) {
    // Recursively extract from subquery
    return extractCollectionFromSource(from.query)
  } else if (from.type === `unionFrom`) {
    return extractCollectionFromSource({ from: from.sources[0] })
  } else if (from.type === `unionAll`) {
    return extractCollectionFromSource(from.queries[0])
  }

  throw new Error(
    `Failed to extract collection. Invalid FROM clause: ${JSON.stringify(query)}`,
  )
}

/**
 * Check if a value is a nested select object (plain object, not an expression)
 */
function isNestedSelectObject(obj: any): boolean {
  if (obj === null || typeof obj !== `object`) return false
  if (isExpressionLike(obj)) return false
  // Ref proxies from spread operations
  if (obj.__refProxy) return false
  return true
}

/**
 * Builds a query IR from a config object that contains either a query builder
 * function or a QueryBuilder instance.
 */
export function buildQueryFromConfig<TContext extends Context>(config: {
  query:
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext>)
    | QueryBuilder<TContext>
  requireObjectResult?: boolean
}): QueryIR {
  // Build the query using the provided query builder function or instance
  const query =
    typeof config.query === `function`
      ? buildQuery<TContext>(config.query)
      : getQueryIR(config.query)

  if (
    config.requireObjectResult &&
    query.select &&
    !isNestedSelectObject(query.select)
  ) {
    throw new UnsupportedRootScalarSelectError()
  }

  return query
}

/**
 * Helper function to send changes to a D2 input stream.
 * Converts ChangeMessages to D2 MultiSet data and sends to the input.
 *
 * @returns The number of multiset entries sent
 */
export function sendChangesToInput(
  input: RootStreamBuilder<unknown>,
  changes: Iterable<ChangeMessage>,
): number {
  const multiSetArray: MultiSetArray<unknown> = []
  for (const change of changes) {
    const key = change.key
    if (change.type === `insert`) {
      multiSetArray.push([[key, change.value], 1])
    } else if (change.type === `update`) {
      multiSetArray.push([[key, change.previousValue], -1])
      multiSetArray.push([[key, change.value], 1])
    } else {
      // change.type === `delete`
      multiSetArray.push([[key, change.value], -1])
    }
  }

  if (multiSetArray.length !== 0) {
    input.sendData(new MultiSet(multiSetArray))
  }

  return multiSetArray.length
}

/** Splits updates into a delete of the old value and an insert of the new value */
export function* splitUpdates<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(
  changes: Iterable<ChangeMessage<T, TKey>>,
): Generator<ChangeMessage<T, TKey>> {
  for (const change of changes) {
    if (change.type === `update`) {
      yield { type: `delete`, key: change.key, value: change.previousValue! }
      yield { type: `insert`, key: change.key, value: change.value }
    } else {
      yield change
    }
  }
}

/** Keep each source key at one exact D2 contribution. */
export function reconcileChangesForD2<
  T extends object,
  TKey extends string | number,
>(
  changes: Array<ChangeMessage<T, TKey>>,
  sentRows: Map<TKey, T>,
): Array<ChangeMessage<T, TKey>> {
  const reconciled: Array<ChangeMessage<T, TKey>> = []
  for (const change of changes) {
    const previousValue = sentRows.get(change.key)
    if (change.type === `insert`) {
      if (previousValue !== undefined) continue
      sentRows.set(change.key, change.value)
      reconciled.push(change)
    } else if (change.type === `delete`) {
      if (previousValue === undefined) continue
      sentRows.delete(change.key)
      reconciled.push({ ...change, value: previousValue })
    } else {
      sentRows.set(change.key, change.value)
      reconciled.push(
        previousValue === undefined
          ? { type: `insert`, key: change.key, value: change.value }
          : { ...change, previousValue },
      )
    }
  }
  return reconciled
}

/**
 * Track the biggest value seen in a stream of changes, used for cursor-based
 * pagination in ordered subscriptions. Moving or deleting an emitted row
 * invalidates finite source coverage, even if the local window remains full.
 * Other boundary changes only reset the cursor.
 */
export function trackBiggestSentValue(
  changes: Array<ChangeMessage<any, string | number>>,
  current: unknown | undefined,
  sentRows: ReadonlyMap<string | number, unknown>,
  comparator: (a: any, b: any) => number,
): {
  biggest: unknown
  shouldResetLoadKey: boolean
  invalidatesSourceOrdering: boolean
} {
  const invalidatesSourceOrdering = changes.some((change) => {
    const previous = sentRows.get(change.key)
    if (change.type === `insert` || previous === undefined) return false
    return change.type === `delete` || comparator(previous, change.value) !== 0
  })
  if (
    current !== undefined &&
    changes.some((change) => {
      const previous =
        change.type === `update` ? change.previousValue : change.value
      return change.type !== `insert` && comparator(current, previous) === 0
    })
  ) {
    // Once the last emitted order boundary is deleted or updated, the next
    // request must start from the beginning. This also covers equal-order
    // ties, where the tracked row itself is not distinguishable by the source
    // comparator.
    return {
      biggest: undefined,
      shouldResetLoadKey: true,
      invalidatesSourceOrdering,
    }
  }

  let biggest = current
  let shouldResetLoadKey = false

  for (const change of changes) {
    if (change.type === `delete`) continue

    const isNewKey = !sentRows.has(change.key)

    if (biggest === undefined) {
      biggest = change.value
      shouldResetLoadKey = true
    } else if (comparator(biggest, change.value) < 0) {
      biggest = change.value
      shouldResetLoadKey = true
    } else if (isNewKey) {
      // New key at same sort position — allow another load if needed
      shouldResetLoadKey = true
    }
  }

  return { biggest, shouldResetLoadKey, invalidatesSourceOrdering }
}

/**
 * Compute orderBy/limit subscription hints for an alias.
 * Returns normalised orderBy and effective limit suitable for passing to
 * `subscribeChanges`, or `undefined` values when the query's orderBy cannot
 * be scoped to the given alias (e.g. cross-collection refs or aggregates).
 */
export function computeSubscriptionOrderByHints(
  query: { orderBy?: OrderBy; limit?: number; offset?: number },
  alias: string,
): { orderBy: OrderBy | undefined; limit: number | undefined } {
  const { orderBy, limit, offset } = query
  const effectiveLimit =
    limit !== undefined && offset !== undefined ? limit + offset : limit

  const normalizedOrderBy = orderBy
    ? normalizeOrderByPaths(orderBy, alias)
    : undefined

  // Only pass orderBy when it is scoped to this alias and uses simple refs,
  // to avoid leaking cross-collection paths into backend-specific compilers.
  const canPassOrderBy =
    normalizedOrderBy?.every((clause) => {
      const exp = clause.expression
      if (exp.type !== `ref`) return false
      const path = exp.path
      return Array.isArray(path) && path.length === 1
    }) ?? false

  return {
    orderBy: canPassOrderBy ? normalizedOrderBy : undefined,
    limit: canPassOrderBy ? effectiveLimit : undefined,
  }
}

/** Owns the conservative provider-loading policy for one ordered source. */
export class OrderedSourceLoader {
  private pending: Promise<unknown> | undefined
  private hasEstablishedSourceCoverage = false
  private needsFullSourceRecovery = false
  private requesting = false
  private fullSource = false
  private fullSourceFailed = false
  private failed = false
  private failedWindowOperationGeneration: number | undefined
  private releaseFailedAcquisition: ReleaseLoadSubset | undefined
  private active = true
  private generation = 0
  private lastPage: { count: number; boundary: unknown } | undefined
  private lastPrefixCount: number | undefined
  private hasLastBoundary = false
  private lastBoundary: unknown

  constructor(
    private readonly info: OrderByOptimizationInfo,
    private readonly subscription: CollectionSubscription,
    private readonly alias: string,
    private readonly getBiggest: () => unknown,
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

  start(): void {
    const { index, limit, offset, orderBy, requiresFullSource } = this.info
    if (index) this.subscription.setOrderByIndex(index)
    if (limit === 0) return
    if (requiresFullSource) {
      this.loadFullSource()
      return
    }
    if (!index || orderBy.length !== 1) {
      this.loadPrefix(offset + limit, true)
      return
    }
    this.loadPage(offset + limit, true)
  }

  loadMore(windowOperationGeneration?: number): Promise<unknown> | undefined {
    if (!this.active || this.info.limit === 0 || this.requesting) return
    const mayRetryFailure =
      !this.failed ||
      (windowOperationGeneration !== undefined &&
        windowOperationGeneration !== this.failedWindowOperationGeneration)
    if (!mayRetryFailure) return this.pending
    if (
      (this.failed || this.releaseFailedAcquisition) &&
      windowOperationGeneration !== undefined
    ) {
      // Move ownership to the explicit replacement before releasing the old
      // lease. Adapter cleanup may reenter the loader.
      this.failedWindowOperationGeneration = windowOperationGeneration
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
      this.fullSource = false
      this.fullSourceFailed = false
    }
    if (this.fullSource) return this.pending
    if (this.needsFullSourceRecovery) {
      this.loadFullSource(false, windowOperationGeneration)
      return this.pending
    }
    if (this.info.requiresFullSource) {
      this.loadFullSource(false, windowOperationGeneration)
      return this.pending
    }
    if (!this.info.index || this.info.orderBy.length !== 1) {
      this.loadPrefix(
        this.info.offset + this.info.limit,
        true,
        windowOperationGeneration,
      )
      return this.pending
    }
    if (!this.info.dataNeeded) return this.pending
    const count = Math.max(
      this.info.dataNeeded(),
      this.failed || !this.hasEstablishedSourceCoverage
        ? this.info.offset + this.info.limit
        : 0,
    )
    if (this.pending) return this.pending
    if (count > 0) {
      this.loadPage(count, true, windowOperationGeneration)
    }
    return this.pending
  }

  loadFullSource(
    replaceExistingDemand = false,
    windowOperationGeneration?: number,
  ): void {
    if (!this.active || this.fullSource) return
    this.fullSourceFailed = false
    this.fullSource = true
    try {
      this.requestAndObserve(
        (onLoadSubsetResult) => {
          this.subscription.requestSnapshot({
            trackLoadSubsetPromise: false,
            replaceExistingDemand,
            onLoadSubsetResult,
          })
        },
        false,
        true,
        true,
        windowOperationGeneration,
      )
    } catch (error) {
      this.invalidateSourceCoverage()
      this.fullSource = false
      this.fullSourceFailed = true
      this.failed = true
      this.failedWindowOperationGeneration = windowOperationGeneration
      throw error
    }
  }

  private loadPrefix(
    count: number,
    refine: boolean,
    windowOperationGeneration?: number,
  ): void {
    if (!this.active || this.pending) return
    if (this.lastPrefixCount === count) {
      if ((this.info.dataNeeded?.() ?? 0) > 0) {
        this.loadFullSource(false, windowOperationGeneration)
      }
      return
    }
    try {
      this.requestAndObserve(
        (onLoadSubsetResult) => {
          this.subscription.requestSnapshot({
            orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
            limit: count,
            trackLoadSubsetPromise: false,
            onLoadSubsetResult,
          })
        },
        refine,
        false,
        true,
        windowOperationGeneration,
      )
    } catch (error) {
      this.invalidateSourceCoverage()
      this.failed = true
      this.failedWindowOperationGeneration = windowOperationGeneration
      throw error
    }
    this.lastPrefixCount = count
  }

  resetCursor(): void {
    this.generation++
    this.pending = undefined
    this.hasLastBoundary = false
    this.lastBoundary = undefined
    this.invalidateCursor()
  }

  settleFullSourceReplay(): void {
    if (this.fullSource) this.fullSourceFailed = false
  }

  invalidateCursor(): void {
    this.lastPage = undefined
    this.lastPrefixCount = undefined
  }

  invalidateSourceOrdering(): void {
    this.invalidateCursor()
    this.invalidateSourceCoverage()
  }

  dispose(): void {
    this.active = false
    this.resetCursor()
  }

  private loadPage(
    count: number,
    refine: boolean,
    windowOperationGeneration?: number,
  ): void {
    if (!this.active || this.pending) return
    // Rows observed before the first provider request do not prove ordered
    // source coverage. In particular, a row inserted while limit is zero must
    // not become the cursor when that window first opens.
    const startsFromSourcePrefix = !this.hasEstablishedSourceCoverage
    const biggest = !startsFromSourcePrefix ? this.getBiggest() : undefined
    let minValues: Array<unknown> | undefined
    if (biggest !== undefined) {
      const value = this.info.valueExtractorForRawRow(
        biggest as Record<string, unknown>,
      )
      if (!canExpressCursorOrder(this.info.orderBy, [value])) {
        this.loadPrefix(
          this.info.offset + this.info.limit,
          true,
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
    try {
      this.requestAndObserve(
        (onLoadSubsetResult) => {
          this.subscription.requestLimitedSnapshot({
            orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
            limit: count,
            minValues,
            // Local rows seen before the first provider request prove neither
            // a cursor nor a remote offset. Start the first acquisition at zero.
            offset: startsFromSourcePrefix ? 0 : undefined,
            trackLoadSubsetPromise: false,
            onLoadSubsetResult,
          })
        },
        refine,
        false,
        true,
        windowOperationGeneration,
      )
    } catch (error) {
      this.invalidateSourceCoverage()
      this.failed = true
      this.failedWindowOperationGeneration = windowOperationGeneration
      this.lastPage = undefined
      throw error
    }
  }

  private observe(
    result: LoadSubsetRequestResult,
    releaseAcquisition: ReleaseLoadSubset,
    refine: boolean,
    isFullSource = false,
    establishesSourceCoverage = false,
    windowOperationGeneration?: number,
  ): Promise<void> {
    const generation = this.generation
    const complete = (): void => {
      if (this.pending === tracked) this.pending = undefined
      if (!this.active || generation !== this.generation) return
      this.failed = false
      this.failedWindowOperationGeneration = undefined
      if (establishesSourceCoverage) {
        this.hasEstablishedSourceCoverage = true
      }
      if (isFullSource) {
        this.fullSourceFailed = false
        this.needsFullSourceRecovery = false
      }
      if (refine) {
        this.loadBoundary(windowOperationGeneration)
        return
      }
      // A boundary request may add tied rows without filling the query's
      // window. Resume forward loading once it settles.
      this.loadMore()
    }
    const settlesAsync = result instanceof Promise
    const request = settlesAsync ? result : Promise.resolve()
    const tracked = request.then(
      () => {
        complete()
      },
      (error: unknown) => {
        if (this.pending === tracked) this.pending = undefined
        if (!this.active) return
        // A failed request may already have written only part of its result.
        // None of those rows is a safe continuation boundary.
        this.invalidateSourceCoverage()
        if (generation !== this.generation) return
        if (isFullSource) {
          // A failed request proves no full-source coverage. An explicit
          // window move or later replay may retry it, but an ordinary graph
          // pass must not start an eager retry loop.
          this.fullSourceFailed = true
        }
        this.failed = true
        this.failedWindowOperationGeneration = windowOperationGeneration
        this.releaseFailedAcquisition = releaseAcquisition
        this.lastPage = undefined
        this.lastPrefixCount = undefined
        this.hasLastBoundary = false
        this.lastBoundary = undefined
        throw error
      },
    )
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
    const biggest = this.getBiggest()
    if (biggest === undefined) return
    const value = this.info.valueExtractorForRawRow(
      biggest as Record<string, unknown>,
    )
    const orderBy = normalizeOrderByPaths(this.info.orderBy, this.alias)
    if (!canExpressCursorOrder(orderBy.slice(0, 1), [value])) {
      this.loadFullSource(false, windowOperationGeneration)
      return this.pending
    }
    if (this.hasLastBoundary && Object.is(this.lastBoundary, value)) return
    const where = buildCursorCurrent(orderBy, [value])
    if (!where) {
      this.loadFullSource(false, windowOperationGeneration)
      return this.pending
    }
    this.hasLastBoundary = true
    this.lastBoundary = value
    try {
      return this.requestAndObserve(
        (onLoadSubsetResult) => {
          this.subscription.requestSnapshot({
            where,
            trackLoadSubsetPromise: false,
            onLoadSubsetResult,
          })
        },
        false,
        false,
        false,
        windowOperationGeneration,
      )
    } catch (error) {
      this.invalidateSourceCoverage()
      this.hasLastBoundary = false
      this.lastBoundary = undefined
      this.failed = true
      this.failedWindowOperationGeneration = windowOperationGeneration
      throw error
    }
  }

  private invalidateSourceCoverage(): void {
    this.hasEstablishedSourceCoverage = false
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
    this.invalidateSourceCoverage()
    this.failed = true
    this.failedWindowOperationGeneration = windowOperationGeneration
    if (isFullSource) this.fullSourceFailed = true
    try {
      observed.release({ error })
    } catch {
      // releaseLoadSubset retains cleanup debt for a later retry.
    }
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
    refine: boolean,
    isFullSource: boolean,
    establishesSourceCoverage: boolean,
    windowOperationGeneration?: number,
  ): Promise<void> | undefined {
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
        this.invalidateSourceCoverage()
        this.failed = true
        this.failedWindowOperationGeneration = windowOperationGeneration
        if (isFullSource) this.fullSourceFailed = true
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
        refine,
        isFullSource,
        establishesSourceCoverage,
        windowOperationGeneration,
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
