import { copyLazyRows, expectedLazyRows } from './lazy-paging-model-oracle'
import type { LazyRow, LazyScope } from './lazy-paging-model-oracle'

/**
 * Confirmed application writes change source truth; rejected atomic writes do
 * not. Until settlement, one optimistic operation overlays that truth.
 * Authority: Collection mutation handlers in db/src/types.ts and
 * db/tests/optimistic-history-oracle.ts; two-sided observation in #2269.
 *
 * This small ledger holds authored rows, never a provider read. A put combines
 * insert and update in this model; the driver exercises both public APIs.
 * Backend acknowledgment and optimistic settlement are separate boundaries.
 * A failed put restores the applied source row, which can precede a newer
 * remote revision's application. One public window needs one explanation:
 * a monotone authored source revision, a monotone window request, and the
 * current optimistic operation. Keep every compatible explanation when an
 * optimistic operation hides a source change. Identical stuttering is legal.
 * Backend transactions, SDK caches, pages and commit partitions have no model
 * meaning. Limits: one pending atomic application operation, finite LazyRows.
 */
export type LazyWrite = { id: string; row?: LazyRow }
export class LazyWriteModel {
  private readonly source = new Map<string, LazyRow>()
  private pending: LazyWrite | undefined
  private releasing = false
  private acknowledged = false
  private readonly revisions: Array<Array<LazyRow>> = []
  private readonly windows: Array<LazyScope>
  private explanations = [{ revision: 0, window: 0 }]
  private lastPublication: string | undefined

  constructor(rows: ReadonlyArray<LazyRow>, scope: LazyScope = {}) {
    for (const row of rows) this.source.set(row.id, { ...row })
    this.revisions.push(this.rows())
    this.windows = [{ ...scope }]
  }
  private apply(change: LazyWrite, target: Map<string, LazyRow>): void {
    if (change.row) target.set(change.id, { ...change.row })
    else target.delete(change.id)
  }
  remote(changes: ReadonlyArray<LazyWrite>): void {
    for (const change of changes) this.apply(change, this.source)
    this.revisions.push(this.rows())
  }
  begin(change: LazyWrite): void {
    if (this.pending) throw new Error(`write model: overlapping app operations`)
    this.pending = {
      id: change.id,
      ...(change.row ? { row: { ...change.row } } : {}),
    }
    this.acknowledged = false
  }
  /** Author the successful source proposal before the backend can emit it. */
  offerConfirmation(): void {
    if (!this.pending) throw new Error(`write model: proposal without app work`)
    const proposed = new Map(this.source)
    this.apply(this.pending, proposed)
    this.revisions.push(copyLazyRows([...proposed.values()]))
  }
  acknowledge(confirmed: boolean): void {
    if (!this.pending)
      throw new Error(`write model: settlement without app work`)
    if (this.acknowledged)
      throw new Error(`write model: duplicate acknowledgment`)
    if (confirmed) this.apply(this.pending, this.source)
    this.acknowledged = true
  }
  /** The driver is about to release the handler. This boundary can publish
   * with the optimistic operation still present or with it dropped. */
  startSettlement(): void {
    if (!this.pending || !this.acknowledged)
      throw new Error(`write model: local settlement before acknowledgment`)
    this.releasing = true
  }
  finishSettlement(): void {
    if (!this.releasing)
      throw new Error(`write model: settlement was not started`)
    this.pending = undefined
    this.releasing = false
  }
  rows(optimistic = false): Array<LazyRow> {
    const rows = new Map(this.source)
    if (optimistic && this.pending) this.apply(this.pending, rows)
    return copyLazyRows([...rows.values()])
  }
  window(scope: LazyScope, optimistic = false): Array<LazyRow> {
    return expectedLazyRows(this.rows(optimistic), scope)
  }
  moveWindow(scope: LazyScope): void {
    this.windows.push({ ...scope })
  }
  observeWindow(actual: ReadonlyArray<LazyRow>): void {
    const signature = (rows: ReadonlyArray<LazyRow>) =>
      JSON.stringify(copyLazyRows(rows))
    const observed = signature(actual)
    if (observed === this.lastPublication) return
    const next: Array<{ revision: number; window: number }> = []
    for (const [revision, rows] of this.revisions.entries()) {
      for (const [window, scope] of this.windows.entries()) {
        if (
          !this.explanations.some(
            (prior) => prior.revision <= revision && prior.window <= window,
          )
        )
          continue
        const source = new Map(rows.map((row) => [row.id, row]))
        const candidates = [expectedLazyRows(rows, scope)]
        if (this.pending) {
          this.apply(this.pending, source)
          const optimistic = expectedLazyRows([...source.values()], scope)
          if (this.releasing) candidates.push(optimistic)
          else candidates.splice(0, 1, optimistic)
        }
        if (candidates.some((candidate) => signature(candidate) === observed))
          next.push({ revision, window })
      }
    }
    if (!next.length)
      throw new Error(
        `app publication law: no coherent source/optimistic explanation ${observed}`,
      )
    this.explanations = next
    this.lastPublication = observed
  }
  assertBackend(actual: ReadonlyArray<LazyRow>): void {
    const relation = (rows: ReadonlyArray<LazyRow>) =>
      JSON.stringify(
        copyLazyRows(rows).sort((a, b) => a.id.localeCompare(b.id)),
      )
    if (relation(actual) !== relation(this.rows()))
      throw new Error(
        `app write law: backend differs from authored ledger\nexpected ${relation(this.rows())}\nactual ${relation(actual)}`,
      )
  }
}
