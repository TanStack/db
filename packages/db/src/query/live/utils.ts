import { MultiSet } from '@tanstack/db-ivm'
import { UnsupportedRootScalarSelectError } from '../../errors.js'
import {
  buildCursorCurrent,
  canExpressCursorOrder,
} from '../../utils/cursor.js'
import { normalizeOrderByPaths } from '../compiler/expressions.js'
import { buildQuery, getQueryIR } from '../builder/index.js'
import { collectCollectionSources, isExpressionLike } from '../ir.js'
import type { MultiSetArray, RootStreamBuilder } from '@tanstack/db-ivm'
import type { Collection } from '../../collection/index.js'
import type { CollectionSubscription } from '../../collection/subscription.js'
import type { ChangeMessage, LoadSubsetRequestResult } from '../../types.js'
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
 * pagination in ordered subscriptions. Returns whether the load request key
 * should be reset (allowing another load).
 *
 * @param changes   - changes to process (deletes are skipped)
 * @param current   - the current biggest value (or undefined if none)
 * @param sentRows  - keys already sent to D2 (for new-key detection)
 * @param comparator - orderBy comparator
 * @returns `{ biggest, shouldResetLoadKey }` — the new biggest value and
 *          whether the caller should clear its last-load-request-key
 */
export function trackBiggestSentValue(
  changes: Array<ChangeMessage<any, string | number>>,
  current: unknown | undefined,
  sentRows: { has(key: string | number): boolean },
  comparator: (a: any, b: any) => number,
): { biggest: unknown; shouldResetLoadKey: boolean } {
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
    return { biggest: undefined, shouldResetLoadKey: true }
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

  return { biggest, shouldResetLoadKey }
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
  private fullSource = false
  private failed = false
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
    ) => void = () => {},
  ) {}

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

  loadMore(): Promise<unknown> | undefined {
    if (!this.active || this.info.limit === 0) return
    if (this.fullSource) return this.pending
    if (this.info.requiresFullSource) {
      this.loadFullSource()
      return this.pending
    }
    if (!this.info.index || this.info.orderBy.length !== 1) {
      this.loadPrefix(this.info.offset + this.info.limit, true)
      return this.pending
    }
    if (!this.info.dataNeeded) return this.pending
    const count = Math.max(
      this.info.dataNeeded(),
      this.failed ? this.info.offset + this.info.limit : 0,
    )
    if (this.pending) return count > 0 ? this.pending : undefined
    if (count > 0) this.loadPage(count, true)
    return this.pending
  }

  loadFullSource(): void {
    if (!this.active || this.fullSource) return
    this.fullSource = true
    try {
      this.subscription.requestSnapshot({
        trackLoadSubsetPromise: false,
        onLoadSubsetResult: (result) => {
          this.observe(result, false)
        },
      })
    } catch (error) {
      this.fullSource = false
      throw error
    }
  }

  private loadPrefix(count: number, refine: boolean): void {
    if (!this.active || this.pending) return
    if (this.lastPrefixCount === count) {
      if ((this.info.dataNeeded?.() ?? 0) > 0) this.loadFullSource()
      return
    }
    this.subscription.requestSnapshot({
      orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
      limit: count,
      trackLoadSubsetPromise: false,
      onLoadSubsetResult: (result) => this.observe(result, refine),
    })
    this.lastPrefixCount = count
  }

  resetCursor(): void {
    this.generation++
    this.pending = undefined
    this.invalidateCursor()
  }

  invalidateCursor(): void {
    this.failed = false
    this.lastPage = undefined
    this.lastPrefixCount = undefined
    this.hasLastBoundary = false
    this.lastBoundary = undefined
  }

  dispose(): void {
    this.active = false
    this.resetCursor()
  }

  private loadPage(count: number, refine: boolean): void {
    const biggest = this.getBiggest()
    let minValues: Array<unknown> | undefined
    if (biggest !== undefined) {
      const value = this.info.valueExtractorForRawRow(
        biggest as Record<string, unknown>,
      )
      if (!canExpressCursorOrder(this.info.orderBy, [value])) {
        this.loadPrefix(this.info.offset + this.info.limit, true)
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
      this.subscription.requestLimitedSnapshot({
        orderBy: normalizeOrderByPaths(this.info.orderBy, this.alias),
        limit: count,
        minValues,
        trackLoadSubsetPromise: false,
        onLoadSubsetResult: (result) => this.observe(result, refine),
      })
    } catch (error) {
      this.failed = true
      this.lastPage = undefined
      throw error
    }
  }

  private observe(
    result: LoadSubsetRequestResult,
    refine: boolean,
  ): Promise<void> {
    const generation = this.generation
    let tracked: Promise<void>
    const complete = (): Promise<unknown> | undefined => {
      if (this.pending === tracked) this.pending = undefined
      if (!this.active || generation !== this.generation) return
      this.failed = false
      if (refine) {
        return this.loadBoundary()
      }
      // A boundary request may add tied rows without filling the query's
      // window. Resume forward loading once it settles.
      return this.loadMore()
    }
    const request = result instanceof Promise ? result : Promise.resolve()
    tracked = request
      .then(complete)
      .then(() => undefined)
      .catch((error: unknown) => {
        if (this.pending === tracked) this.pending = undefined
        if (!this.active || generation !== this.generation) return
        this.failed = true
        this.lastPage = undefined
        this.lastPrefixCount = undefined
        this.hasLastBoundary = false
        this.lastBoundary = undefined
        throw error
      })
    this.pending = tracked
    // Track the whole ordered refinement chain, not merely the adapter call
    // that began it. This keeps readiness and imperative window settlement
    // pending until any required tie boundary and forward refill also settle.
    this.onResult(tracked)
    void tracked.catch(() => {})
    return tracked
  }

  private loadBoundary(): Promise<unknown> | undefined {
    const biggest = this.getBiggest()
    if (biggest === undefined) return
    const value = this.info.valueExtractorForRawRow(
      biggest as Record<string, unknown>,
    )
    const orderBy = normalizeOrderByPaths(this.info.orderBy, this.alias)
    if (!canExpressCursorOrder(orderBy.slice(0, 1), [value])) {
      this.loadFullSource()
      return this.pending
    }
    if (this.hasLastBoundary && Object.is(this.lastBoundary, value)) return
    const where = buildCursorCurrent(orderBy, [value])
    if (!where) {
      this.loadFullSource()
      return this.pending
    }
    this.hasLastBoundary = true
    this.lastBoundary = value
    let tracked: Promise<void> | undefined
    try {
      this.subscription.requestSnapshot({
        where,
        trackLoadSubsetPromise: false,
        onLoadSubsetResult: (result) => {
          tracked = this.observe(result, false)
        },
      })
    } catch (error) {
      this.hasLastBoundary = false
      this.lastBoundary = undefined
      throw error
    }
    return tracked
  }
}
