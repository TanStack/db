import { deepEquals } from '../../utils.js'
import { compileSingleRowExpression } from '../compiler/evaluators.js'
import { TotalOrder } from '../total-order.js'
import type { CollectionImpl } from '../../collection/index.js'
import type { ChangeMessage } from '../../types.js'
import type { BasicExpression, OrderBy } from '../ir.js'
import type { TotalOrderBoundary } from '../total-order.js'

/**
 * Owns the active ordered demand and its retained local coverage. Rows outside
 * the retained prefix stay in the source collection until a later window
 * admits them; they never become accidental top-K candidates.
 */
export class WindowState<
  TRow extends object = object,
  TKey extends string | number = string | number,
> {
  readonly totalOrder: TotalOrder<TRow, TKey>
  private activeSize: number
  private retainedSize: number
  private coveredSize = 0
  private hasFullCoverage = false
  private needsFullRefinement = false
  private needsPrefixRefresh = false
  private hasInitialCoverage = false
  private hasUnsettledInitialMutation = false
  private revision = 0
  private readonly matchesWhere: (row: TRow) => boolean
  private readonly candidateKeys = new Set<TKey>()
  private readonly provenanceKeys = new Set<TKey>()
  private readonly admittedKeys = new Set<TKey>()

  constructor(
    private readonly collection: CollectionImpl<TRow, TKey>,
    orderBy: OrderBy,
    private readonly where: BasicExpression<boolean> | undefined,
    targetSize: number,
  ) {
    this.totalOrder = new TotalOrder(orderBy, collection)
    const evaluateWhere = where && compileSingleRowExpression(where)
    this.matchesWhere = evaluateWhere
      ? (row) => evaluateWhere(row as Record<string, unknown>) === true
      : () => true
    this.activeSize = targetSize
    this.retainedSize = targetSize
  }

  ensureSize(size: number): void {
    this.activeSize = size
    this.retainedSize = Math.max(this.retainedSize, size)
  }

  get size(): number {
    return this.activeSize
  }

  get retainedPrefixSize(): number {
    return this.retainedSize
  }

  get localPrefixSize(): number {
    return this.readPrefix().length
  }

  /** The exact rows in the current retained ordered publication. */
  publicationEntries(): Array<readonly [TKey, TRow]> {
    return this.readPrefix().map(({ key, value }) => [key, value] as const)
  }

  get coversActiveWindow(): boolean {
    return this.hasFullCoverage || this.coveredSize >= this.activeSize
  }

  get coveredPrefixSize(): number {
    return this.coveredSize
  }

  /** A replacement can publish only after proving its retained prefix. */
  get coversRetainedWindow(): boolean {
    return this.hasFullCoverage || this.coveredSize >= this.retainedSize
  }

  get requiresFullRefinement(): boolean {
    return this.needsFullRefinement
  }

  get requiresPrefixRefresh(): boolean {
    return this.needsPrefixRefresh
  }

  get coverageRevision(): number {
    return this.revision
  }

  rowsNeeded(): number {
    return Math.max(0, this.activeSize - this.localPrefixSize)
  }

  /** Discard source-generation evidence before a truncate replacement. */
  resetCoverage(): void {
    this.revision++
    this.coveredSize = 0
    this.hasFullCoverage = false
    this.needsFullRefinement = false
    this.needsPrefixRefresh = false
    this.hasInitialCoverage = false
    this.hasUnsettledInitialMutation = false
    this.candidateKeys.clear()
    this.provenanceKeys.clear()
    this.admittedKeys.clear()
  }

  recordInitialCoverage(
    rowKeys: ReadonlyArray<TKey> | undefined,
    exhausted: boolean,
  ): void {
    this.hasInitialCoverage = true
    if (exhausted) {
      this.hasUnsettledInitialMutation = false
      this.establishFullCoverage()
      return
    }
    if (rowKeys === undefined) {
      this.hasUnsettledInitialMutation = false
      this.candidateKeys.clear()
      this.provenanceKeys.clear()
      this.needsFullRefinement = true
      return
    }
    const appliedKeys = new Set(rowKeys)
    if (
      this.hasUnsettledInitialMutation ||
      [...this.candidateKeys].some((key) => !appliedKeys.has(key))
    ) {
      this.needsPrefixRefresh = true
    }
    this.hasUnsettledInitialMutation = false
    // Changes may arrive after the establishing writes commit but before the
    // adapter promise settles. Keep those staged keys alongside the receipt.
    for (const key of rowKeys) this.candidateKeys.add(key)
  }

  recordContinuationCoverage(
    rowKeys: ReadonlyArray<TKey> | undefined,
    exhausted: boolean,
    requestedPrefix: number,
    requestRevision: number,
  ): void {
    this.hasInitialCoverage = true
    if (exhausted) {
      this.establishFullCoverage()
      return
    }
    if (rowKeys === undefined) {
      this.candidateKeys.clear()
      this.provenanceKeys.clear()
      this.coveredSize = 0
      this.needsFullRefinement = true
      this.needsPrefixRefresh = false
      return
    }
    const refreshInvalidatedPrefix = this.revision !== requestRevision
    for (const key of this.candidateKeys) {
      this.admittedKeys.add(key)
      this.provenanceKeys.add(key)
    }
    this.candidateKeys.clear()
    for (const key of rowKeys) {
      this.admittedKeys.add(key)
      this.provenanceKeys.add(key)
    }
    if (refreshInvalidatedPrefix) {
      // Live changes that raced the continuation are visible, but its original
      // request no longer proves the new prefix. Keep the result admitted and
      // reacquire from the start before using any of it as a boundary.
      this.coveredSize = 0
    } else {
      // A requested prefix is intent, not evidence. A short continuing page
      // proves only the rows that this ordered demand has actually admitted.
      this.coveredSize = Math.max(
        this.coveredSize,
        Math.min(requestedPrefix, this.localPrefixSize),
      )
      this.needsPrefixRefresh = false
    }
  }

  /**
   * An outcome-free completion without applied row keys still says this exact
   * request has settled. Admit only the current local prefix. A later expansion
   * must refresh from the start because these rows are not a reusable cursor
   * proof.
   */
  recordLocalRequestSatisfaction(requestedPrefix: number): void {
    this.candidateKeys.clear()
    this.provenanceKeys.clear()
    this.admittedKeys.clear()
    for (const change of this.readRows(undefined, requestedPrefix)) {
      this.admittedKeys.add(change.key)
    }
    // Outcome-free completions (`true` and Promise<void>) do not prove
    // exhaustion. Only count rows that are now present, so a short synchronous
    // page can request another pass until the active prefix is actually filled.
    this.coveredSize = Math.min(requestedPrefix, this.admittedKeys.size)
    this.needsFullRefinement = false
    this.needsPrefixRefresh = true
  }

  admitChanges(changes: ReadonlyArray<ChangeMessage<TRow, TKey>>): void {
    if (this.hasFullCoverage) return

    // Initial applied rows remain candidates until their boundary equivalence
    // class is refined. Live source changes during that request still belong
    // to the same ordered prefix and must survive its later settlement.
    if (this.admittedKeys.size === 0) {
      if (this.hasInitialCoverage) {
        if (this.updateKnownPrefix(this.candidateKeys, changes)) {
          this.revision++
          this.coveredSize = 0
          this.provenanceKeys.clear()
          this.needsFullRefinement = false
          this.needsPrefixRefresh = true
        }
        return
      }
      for (const change of changes) {
        if (change.type !== `insert` || this.candidateKeys.has(change.key)) {
          this.hasUnsettledInitialMutation = true
        }
        if (change.type === `delete`) this.candidateKeys.delete(change.key)
        else this.candidateKeys.add(change.key)
      }
      return
    }

    const visibleChanges = changes.filter(
      ({ value, previousValue }) =>
        this.matchesWhere(value) ||
        (previousValue !== undefined && this.matchesWhere(previousValue)),
    )
    if (
      visibleChanges.length > 0 &&
      this.updateKnownPrefix(this.admittedKeys, visibleChanges)
    ) {
      this.revision++
      // A live change may update the visible prefix at once, but an applied
      // snapshot fact does not prove the new remote boundary. Reacquire from
      // the start instead of continuing from a row whose provenance changed.
      this.coveredSize = 0
      this.candidateKeys.clear()
      this.provenanceKeys.clear()
      this.needsFullRefinement = false
      this.needsPrefixRefresh = true
    }
  }

  private updateKnownPrefix(
    knownKeys: Set<TKey>,
    changes: ReadonlyArray<ChangeMessage<TRow, TKey>>,
  ): boolean {
    let invalidated = false
    const possiblePrefix = new Set(knownKeys)
    for (const change of changes) {
      if (change.type === `delete`) {
        possiblePrefix.delete(change.key)
        if (knownKeys.has(change.key)) invalidated = true
        continue
      }

      if (knownKeys.has(change.key)) {
        invalidated = true
        continue
      }
      possiblePrefix.add(change.key)
    }

    // Evaluate the final batch once. The retained prefix, not only the active
    // window, must survive a temporary shrink so a later expansion is exact.
    const retainedPrefix = new Set(
      this.readRows(possiblePrefix, this.retainedSize).map(({ key }) => key),
    )
    if (
      retainedPrefix.size !== knownKeys.size ||
      [...retainedPrefix].some((key) => !knownKeys.has(key))
    ) {
      invalidated = true
    }
    knownKeys.clear()
    for (const key of retainedPrefix) knownKeys.add(key)
    return invalidated
  }

  boundary(
    staleRows?: ReadonlyMap<TKey, TRow>,
  ): TotalOrderBoundary<TKey> | undefined {
    // A failed truncate replay may have installed only part of the next
    // snapshot in the source collection. Its boundary is not a continuation
    // point. Keep using the last complete publication until a replay settles.
    if (staleRows) {
      const fallback = [...staleRows]
        .sort((left, right) => this.totalOrder.compareEntries(left, right))
        .at(-1)
      return fallback && this.totalOrder.boundary(fallback[1], fallback[0])
    }

    const lastPrefixRow = this.readPrefix().at(-1)
    if (lastPrefixRow) {
      return this.totalOrder.boundary(lastPrefixRow.value, lastPrefixRow.key)
    }
    return undefined
  }

  requestBoundary(): TotalOrderBoundary<TKey> | undefined {
    // Applied source rows prove cursor progress even when this subscription's
    // predicate excludes them. Keep that source boundary separate from the
    // eligible rows admitted to the visible result prefix.
    const hasContinuationProvenance = this.provenanceKeys.size > 0
    const rows = this.readSourceRows(
      this.hasFullCoverage
        ? undefined
        : hasContinuationProvenance
          ? this.provenanceKeys
          : this.candidateKeys,
      this.hasFullCoverage || !hasContinuationProvenance
        ? this.retainedSize
        : undefined,
    )
    const lastRow = rows.at(-1)
    return lastRow && this.totalOrder.boundary(lastRow.value, lastRow.key)
  }

  /**
   * Distinguishes automatic refill passes without claiming a reusable cursor.
   * Outcome-free loads can move this local boundary while requestBoundary()
   * stays empty and forces the adapter request to refresh from the start.
   */
  progressBoundary(): TotalOrderBoundary<TKey> | undefined {
    return this.requestBoundary() ?? this.boundary()
  }

  reconcile(
    publishedRows: ReadonlyMap<TKey, TRow>,
    retainOutsideWindow?: (row: TRow) => boolean,
  ): Array<ChangeMessage<TRow, TKey>> {
    const snapshot = this.readPrefix()

    const desired = new Map<TKey, TRow>()
    for (const change of snapshot) desired.set(change.key, change.value)
    if (retainOutsideWindow) {
      for (const [key, value] of this.collection.entries()) {
        if (retainOutsideWindow(value)) desired.set(key, value)
      }
    }

    const changes: Array<ChangeMessage<TRow, TKey>> = []
    for (const [key, previousValue] of publishedRows) {
      const value = desired.get(key)
      if (value === undefined) {
        changes.push({ type: `delete`, key, value: previousValue })
      } else if (!deepEquals(previousValue, value)) {
        changes.push({ type: `update`, key, value, previousValue })
      }
    }
    for (const [key, value] of desired) {
      if (!publishedRows.has(key)) changes.push({ type: `insert`, key, value })
    }
    return changes
  }

  private readPrefix(): Array<ChangeMessage<TRow, TKey>> {
    if (this.admittedKeys.size === 0 && !this.hasFullCoverage) return []
    return this.readRows(
      this.hasFullCoverage ? undefined : this.admittedKeys,
      this.retainedSize,
    )
  }

  private establishFullCoverage(): void {
    this.hasFullCoverage = true
    this.needsFullRefinement = false
    this.needsPrefixRefresh = false
    this.coveredSize = Number.POSITIVE_INFINITY
    this.candidateKeys.clear()
    this.provenanceKeys.clear()
    this.admittedKeys.clear()
  }

  private readRows(
    allowedKeys: ReadonlySet<TKey> | undefined,
    limit?: number,
  ): Array<ChangeMessage<TRow, TKey>> {
    const rows = this.collection.currentStateAsChanges({
      ...(this.where && { where: this.where }),
      orderBy: this.totalOrder.orderBy,
    }) as Array<ChangeMessage<TRow, TKey>> | undefined
    const allowed =
      allowedKeys === undefined
        ? (rows ?? [])
        : (rows ?? []).filter((change) => allowedKeys.has(change.key))
    return limit === undefined ? allowed : allowed.slice(0, limit)
  }

  private readSourceRows(
    allowedKeys: ReadonlySet<TKey> | undefined,
    limit?: number,
  ): Array<ChangeMessage<TRow, TKey>> {
    const rows = this.collection.currentStateAsChanges({
      orderBy: this.totalOrder.orderBy,
    }) as Array<ChangeMessage<TRow, TKey>> | undefined
    const allowed =
      allowedKeys === undefined
        ? (rows ?? [])
        : (rows ?? []).filter((change) => allowedKeys.has(change.key))
    return limit === undefined ? allowed : allowed.slice(0, limit)
  }
}
