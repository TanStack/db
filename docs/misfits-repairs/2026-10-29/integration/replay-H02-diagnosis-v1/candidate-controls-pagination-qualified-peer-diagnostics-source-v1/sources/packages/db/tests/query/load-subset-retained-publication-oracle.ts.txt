import { expect } from 'vitest'
import { declareOracle } from '../oracle-declaration.js'

/**
 * ARCHITECTURE law 9 retains the last complete public snapshot while replay
 * work is pending or failed. The expected value is the snapshot before that
 * barrier rose, independent of the private replacement and replay machinery.
 * Drivers establish the barrier premise from adapter-observed work. Once all
 * successful work settles, the same law requires the replacement to publish.
 * This judgment compares the complete ordered public value at either cut.
 */
export function checkReplayPublication(
  actual: unknown,
  expected: unknown,
  label: string,
) {
  expect(actual, label).toEqual(expected)
}

// Retain the original entry point for retention cuts and existing replays.
export function checkRetainedPublication(
  actual: unknown,
  retained: unknown,
  label: string,
) {
  checkReplayPublication(actual, retained, label)
}

/**
 * Independent finite query calculation for the anti-joined receiving profile.
 * Source rows have distinct numeric ranks. A row without a marker qualifies;
 * order and slice select the window, and its include contains no marker. This
 * model reads provider facts, never replay state or production query helpers.
 */
export function modelAntiJoinReplayWindow(
  rows: ReadonlyArray<{ id: number; rank: number }>,
  marked: ReadonlySet<number>,
  direction: `asc` | `desc`,
  offset: number,
  limit: number,
): Array<{ id: number; rank: number; markers: Array<number> }> {
  return modelOrderedReplayWindow(
    rows,
    marked,
    direction,
    offset,
    limit,
    `unmarked`,
    true,
  )
}

/**
 * The ordered root, its optional marker filter and its optional include are
 * independent finite relational operations. A failed operation keeps its prior
 * snapshot; a successful operation selects this complete value (architecture
 * law 9 and Atomic window publication). The marker set is provider truth,
 * never an account of which requests production happened to start.
 */
export function modelOrderedReplayWindow(
  rows: ReadonlyArray<{ id: number; rank: number }>,
  marked: ReadonlySet<number>,
  direction: `asc` | `desc`,
  offset: number,
  limit: number,
  selection: `all` | `marked` | `unmarked`,
  includes: boolean,
): Array<{ id: number; rank: number; markers: Array<number> }> {
  const sign = direction === `asc` ? 1 : -1
  return rows
    .filter(
      ({ id }) =>
        selection === `all` || marked.has(id) === (selection === `marked`),
    )
    .sort((left, right) => sign * (left.rank - right.rank))
    .slice(offset, offset + limit)
    .map(({ id, rank }) => ({
      id,
      rank,
      markers: includes && marked.has(id) ? [id] : [],
    }))
}

declareOracle({
  check: [checkReplayPublication, checkRetainedPublication],
  model: [modelAntiJoinReplayWindow, modelOrderedReplayWindow],
})
