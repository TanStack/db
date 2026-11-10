import { isDeepStrictEqual } from 'node:util'
import { declareOracle } from '../oracle-declaration.js'
import type { PageRow } from './pagination-support.js'

/**
 * Atomic window publication retains the last complete public snapshot when
 * required refinement fails. Authority: live/ARCHITECTURE.md, "Atomic window
 * publication". The primary pagination driver and real QueryClient receiver
 * share this finite recomputation and retained-snapshot judgment.
 *
 * Arrays of authored source facts define the answer; request, cache, loader,
 * and graph state do not. This model covers ordered numeric roots, an anti-join
 * marker per root, and ascending child IDs. It does not judge metadata,
 * provider scheduling, operation settlement, or callback counts. The receiving
 * delivery checker separately judges event reconstruction from these rows.
 */
export type PaginationWindow = { offset: number; limit: number }
export type JoinedWindowRow = {
  id: number
  rank: number
  children: Array<number>
}
export type JoinedWindowFacts = {
  roots: ReadonlyArray<{ id: number; rank: number }>
  marked: ReadonlyArray<number>
  children: ReadonlyArray<{ id: number; parent: number }>
}

// This is the primary pagination reference, moved without semantic changes.
// Sorting the complete finite source before slicing does not borrow the
// production continuation boundary or infer unrequested source extent.
export function referenceWindowRows(
  rows: ReadonlyArray<PageRow>,
  direction: `asc` | `desc`,
  window: PaginationWindow,
): Array<PageRow> {
  return [...rows]
    .sort((left, right) => {
      // The public NaN contract places NaN after finite ranks in ascending
      // order. The key breaks ties between equal ranks, including two NaNs.
      const rankOrder = Number.isNaN(left.rank)
        ? Number.isNaN(right.rank)
          ? 0
          : 1
        : Number.isNaN(right.rank)
          ? -1
          : left.rank < right.rank
            ? -1
            : left.rank > right.rank
              ? 1
              : 0
      return rankOrder * (direction === `asc` ? 1 : -1) || left.id - right.id
    })
    .slice(window.offset, window.offset + window.limit)
    .map(({ id, rank }) => ({ id, rank }))
}

// A complete inline row includes its child contents. Correct root membership
// with an empty child array is distinguishable from the promised snapshot.
export function referenceJoinedWindowRows(
  facts: JoinedWindowFacts,
  direction: `asc` | `desc`,
  window: PaginationWindow,
): Array<JoinedWindowRow> {
  const marked = new Set(facts.marked)
  return referenceWindowRows(
    facts.roots.filter(({ id }) => !marked.has(id)),
    direction,
    window,
  ).map(({ id, rank }) => ({
    id,
    rank,
    children: facts.children
      .filter((child) => child.parent === id)
      .map((child) => child.id)
      .sort((left, right) => left - right),
  }))
}

/**
 * Drivers record callbacks without checking them, then call this judgment at
 * the handled-failure checkpoint before peer release or operation waiting.
 * An unchanged retained snapshot needs no row callback. A missing window or
 * one torn callback remains representable and is rejected here.
 */
export function checkRetainedWindowSnapshot(
  expected: {
    rows: ReadonlyArray<JoinedWindowRow>
    window: PaginationWindow
  },
  actual: {
    rows: ReadonlyArray<JoinedWindowRow>
    window: PaginationWindow | undefined
  },
  checkpoint: string,
): void {
  if (!isDeepStrictEqual(actual.rows, expected.rows))
    throw new Error(
      `atomic window publication at ${checkpoint}: expected rows ${JSON.stringify(expected.rows)}, got ${JSON.stringify(actual.rows)}`,
    )
  if (!isDeepStrictEqual(actual.window, expected.window))
    throw new Error(
      `atomic window publication at ${checkpoint}: expected settled window ${JSON.stringify(expected.window)}, got ${JSON.stringify(actual.window)}`,
    )
}

declareOracle({
  model: [referenceWindowRows, referenceJoinedWindowRows],
  check: [checkRetainedWindowSnapshot],
})
