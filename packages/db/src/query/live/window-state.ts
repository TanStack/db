import { deepEquals } from '../../utils.js'
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

  get localPrefixSize(): number {
    return this.readPrefix()?.length ?? 0
  }

  get coversActiveWindow(): boolean {
    return this.hasFullCoverage || this.coveredSize >= this.activeSize
  }

  get requiresFullRefinement(): boolean {
    return this.needsFullRefinement
  }

  get requiresPrefixRefresh(): boolean {
    return this.needsPrefixRefresh
  }

  rowsNeeded(): number {
    return Math.max(0, this.activeSize - this.localPrefixSize)
  }

  /** Discard source-generation evidence before a truncate replacement. */
  resetCoverage(): void {
    this.coveredSize = 0
    this.hasFullCoverage = false
    this.needsFullRefinement = false
    this.needsPrefixRefresh = false
    this.candidateKeys.clear()
    this.provenanceKeys.clear()
    this.admittedKeys.clear()
  }

  recordInitialCoverage(
    rowKeys: ReadonlyArray<TKey> | undefined,
    exhausted: boolean,
  ): void {
    this.needsPrefixRefresh = false
    if (exhausted) {
      this.establishFullCoverage()
      return
    }
    if (rowKeys === undefined) {
      this.candidateKeys.clear()
      this.provenanceKeys.clear()
      this.needsFullRefinement = true
      return
    }
    this.candidateKeys.clear()
    for (const key of rowKeys) this.candidateKeys.add(key)
  }

  recordContinuationCoverage(
    rowKeys: ReadonlyArray<TKey> | undefined,
    exhausted: boolean,
    requestedPrefix: number,
    fullRegion: boolean,
  ): void {
    this.needsPrefixRefresh = false
    if (fullRegion || exhausted) {
      this.establishFullCoverage()
      return
    }
    if (rowKeys === undefined) {
      this.candidateKeys.clear()
      this.provenanceKeys.clear()
      this.coveredSize = 0
      this.needsFullRefinement = true
      return
    }
    for (const key of this.candidateKeys) {
      this.admittedKeys.add(key)
      this.provenanceKeys.add(key)
    }
    this.candidateKeys.clear()
    for (const key of rowKeys) {
      this.admittedKeys.add(key)
      this.provenanceKeys.add(key)
    }
    this.coveredSize = Math.max(this.coveredSize, requestedPrefix)
  }

  /**
   * A legacy result without applied row keys still says this exact request has
   * settled. Admit only the current local prefix. A later expansion must
   * refresh from the start because these rows are not a reusable cursor proof.
   */
  recordLocalRequestSatisfaction(requestedPrefix: number): void {
    this.candidateKeys.clear()
    this.provenanceKeys.clear()
    this.admittedKeys.clear()
    for (const change of this.readRows(undefined, requestedPrefix)) {
      this.admittedKeys.add(change.key)
    }
    // `true` and legacy Promise<void> do not prove exhaustion. Only count rows
    // that are now present, so a short synchronous page can request another
    // pass until the active prefix is actually filled.
    this.coveredSize = Math.min(requestedPrefix, this.admittedKeys.size)
    this.needsFullRefinement = false
    this.needsPrefixRefresh = true
  }

  admitChanges(changes: ReadonlyArray<ChangeMessage<TRow, TKey>>): void {
    if (this.hasFullCoverage) {
      for (const change of changes) {
        if (change.type === `delete`) this.admittedKeys.delete(change.key)
        else this.admittedKeys.add(change.key)
      }
      return
    }
    if (this.admittedKeys.size === 0) return

    let invalidated = false
    for (const change of changes) {
      if (change.type === `delete`) {
        if (this.admittedKeys.delete(change.key)) invalidated = true
        continue
      }

      if (this.admittedKeys.has(change.key)) {
        invalidated = true
        continue
      }

      const possiblePrefix = new Set(this.admittedKeys)
      possiblePrefix.add(change.key)
      if (
        this.readRows(possiblePrefix, this.activeSize).some(
          (row) => row.key === change.key,
        )
      ) {
        this.admittedKeys.add(change.key)
        invalidated = true
      }
    }

    if (invalidated) {
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

    const lastPrefixRow = this.readPrefix()?.at(-1)
    if (lastPrefixRow) {
      return this.totalOrder.boundary(lastPrefixRow.value, lastPrefixRow.key)
    }
    return undefined
  }

  requestBoundary(): TotalOrderBoundary<TKey> | undefined {
    const rows = this.readRows(
      this.hasFullCoverage
        ? undefined
        : this.provenanceKeys.size > 0
          ? this.provenanceKeys
          : this.candidateKeys,
      this.retainedSize,
    )
    const lastRow = rows.at(-1)
    return lastRow && this.totalOrder.boundary(lastRow.value, lastRow.key)
  }

  reconcile(
    publishedRows: ReadonlyMap<TKey, TRow>,
    retainOutsideWindow?: (row: TRow) => boolean,
  ): Array<ChangeMessage<TRow, TKey>> {
    const snapshot = this.readPrefix()
    if (!snapshot) return []

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

  private readPrefix(): Array<ChangeMessage<TRow, TKey>> | undefined {
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
    for (const change of this.readRows(undefined)) {
      this.admittedKeys.add(change.key)
      this.provenanceKeys.add(change.key)
    }
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
}
