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

  rowsNeeded(): number {
    return Math.max(0, this.activeSize - this.localPrefixSize)
  }

  boundary(
    staleRows?: ReadonlyMap<TKey, TRow>,
  ): TotalOrderBoundary<TKey> | undefined {
    const lastPrefixRow = this.readPrefix()?.at(-1)
    if (lastPrefixRow) {
      return this.totalOrder.boundary(lastPrefixRow.value, lastPrefixRow.key)
    }
    // Only failed-replay state may stand in for an absent source prefix.
    // Independently demanded rows must never move the ordered boundary.
    const fallback = staleRows
      ? [...staleRows]
          .sort((left, right) => this.totalOrder.compareEntries(left, right))
          .at(-1)
      : undefined
    return fallback && this.totalOrder.boundary(fallback[1], fallback[0])
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
    return this.collection.currentStateAsChanges({
      ...(this.where && { where: this.where }),
      orderBy: this.totalOrder.orderBy,
      limit: this.retainedSize,
    }) as Array<ChangeMessage<TRow, TKey>> | undefined
  }
}
