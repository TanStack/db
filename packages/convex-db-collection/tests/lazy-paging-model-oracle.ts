/**
 * Fixed-query lazy paging: exact subset coverage is separate from the public
 * window and from permission to start another provider range. Authority:
 * LoadSubsetOptions/LoadSubsetFn in db/src/types.ts, atomic window publication
 * in query/live/ARCHITECTURE.md, and the maintainer-approved lazy-paging design
 * (2026-10-26). The work promise is new: no unrelated successor after delivered
 * evidence closes every active scope. Reacquiring an existing interval is legal.
 *
 * This model orders the full authored source to predict values. The separate
 * work relation below receives only delivered rows/exhaustion; hidden suffixes
 * cannot tell the adapter that a tie is already closed. It imports no adapter
 * parser, cursor implementation, comparator, or Collection snapshot.
 * Limits: finite numeric rank, unique string IDs, one aligned query; provider
 * cache coherence, native cursor correctness and timing need receiving drivers.
 */
export type LazyRow = { id: string; rank: number; text: string }
export type LazyScope = {
  offset?: number
  limit?: number
  equal?: number
  after?: number
}
export const copyLazyRows = (rows: ReadonlyArray<LazyRow>): Array<LazyRow> =>
  rows.map(({ id, rank, text }) => ({ id, rank, text }))

/** Cleanup law 14 in live/ARCHITECTURE.md: the old graph keeps its last
 * complete value and terminal crash, including after a fresh run recovers.
 * Only cleanup authority and the last public value have scientific meaning. */
export class LazyTerminalGraphModel {
  private snapshot: Array<LazyRow> | undefined

  cleanup(rows: ReadonlyArray<LazyRow>): void {
    this.snapshot = copyLazyRows(rows)
  }

  observe(status: string, rows: ReadonlyArray<LazyRow>): void {
    if (!this.snapshot) return
    if (status !== `crashed`)
      throw new Error(`native lifecycle: old graph recovered`)
    if (JSON.stringify(copyLazyRows(rows)) !== JSON.stringify(this.snapshot))
      throw new Error(`native lifecycle: dead graph published`)
  }
}
export const ordered = (rows: ReadonlyArray<LazyRow>, descending = false) =>
  [...rows].sort((a, b) =>
    descending
      ? b.rank - a.rank || b.id.localeCompare(a.id)
      : a.rank - b.rank || a.id.localeCompare(b.id),
  )

export function expectedLazyRows(
  rows: ReadonlyArray<LazyRow>,
  scope: LazyScope,
  descending = false,
): Array<LazyRow> {
  const matching = ordered(rows, descending).filter(
    (row) =>
      (scope.equal === undefined || row.rank === scope.equal) &&
      (scope.after === undefined ||
        (descending ? row.rank < scope.after : row.rank > scope.after)),
  )
  const offset = scope.offset ?? 0
  return matching
    .slice(offset, scope.limit === undefined ? undefined : offset + scope.limit)
    .map(({ id, rank, text }) => ({ id, rank, text }))
}

export function expectedLazyCoverage(
  source: ReadonlyArray<LazyRow>,
  scope: LazyScope,
  descending = false,
): Array<LazyRow> {
  const display = expectedLazyRows(source, scope, descending)
  const last = display.at(-1)
  if (!last) return []
  // A served ordered prefix includes the complete leading-value tie, even
  // when only one of its IDs appears in the displayed window.
  return ordered(source, descending).filter(
    (row) =>
      (scope.equal === undefined || row.rank === scope.equal) &&
      (scope.after === undefined ||
        (descending ? row.rank < scope.after : row.rank > scope.after)) &&
      (descending ? row.rank >= last.rank : row.rank <= last.rank),
  )
}

export function deliveredScopeComplete(
  delivered: ReadonlyArray<LazyRow>,
  exhausted: boolean,
  scope: LazyScope,
  descending = false,
): boolean {
  if (scope.limit === 0 || exhausted) return true
  const matching = expectedLazyRows(
    delivered,
    { ...scope, offset: 0, limit: undefined },
    descending,
  )
  if (
    scope.equal !== undefined &&
    delivered.some((row) =>
      descending ? row.rank < scope.equal! : row.rank > scope.equal!,
    )
  )
    return true
  if (
    scope.limit === undefined ||
    matching.length < (scope.offset ?? 0) + scope.limit
  )
    return false
  const boundary = matching[(scope.offset ?? 0) + scope.limit - 1]!.rank
  return delivered.some((row) =>
    descending ? row.rank < boundary : row.rank > boundary,
  )
}

export function assertLazyCoverage(
  actual: ReadonlyArray<LazyRow>,
  source: ReadonlyArray<LazyRow>,
  scope: LazyScope,
  descending = false,
): void {
  for (const row of expectedLazyCoverage(source, scope, descending)) {
    const found = actual.find((candidate) => candidate.id === row.id)
    if (!found || found.rank !== row.rank || found.text !== row.text)
      throw new Error(`lazy coverage: missing/current row ${row.id}`)
  }
}

/** Compare the applied provider base, never the optimistic overlay. Every
 * applied row/version must have been supplied as observable provider evidence
 * in this run. Historical delivered versions remain lawful while newer writes
 * wait for application. This detects invented rows without imposing retention
 * or requiring a future revision to be visible early. */
export function assertLazySourceFacts(
  base: ReadonlyArray<LazyRow>,
  evidence: ReadonlyArray<LazyRow>,
): void {
  const fact = ({ id, rank, text }: LazyRow) => JSON.stringify([id, rank, text])
  const delivered = new Set(evidence.map(fact))
  for (const row of base)
    if (!delivered.has(fact(row)))
      throw new Error(`lazy source: undelivered applied fact ${fact(row)}`)
}

/** Every observed public snapshot is the old complete window until the new one
 * appears; it may then repeat, but cannot fall back or expose a repaired prefix. */
export function assertLazyPublications(
  trace: ReadonlyArray<ReadonlyArray<LazyRow>>,
  prior: ReadonlyArray<LazyRow>,
  next: ReadonlyArray<LazyRow>,
): void {
  let advanced = false
  const key = (rows: ReadonlyArray<LazyRow>) => JSON.stringify(rows)
  for (const rows of trace) {
    if (key(rows) === key(next)) advanced = true
    else if (key(rows) !== key(advanced ? next : prior))
      throw new Error(
        `lazy publication: partial or stale public window ${key(rows)}`,
      )
  }
}
