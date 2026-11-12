/**
 * The independent window model, request-trace checks, and named model cases of
 * `pagination-oracle.property.test.ts`, moved unchanged so that their model and
 * checker calibrations in `pagination-model.test.ts` can read them. That oracle
 * file states the law and its authority. This module registers no tests and
 * keeps no state.
 */
import { expect } from 'vitest'
import { PropRef } from '../../src/query/ir.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { compareAt } from './ordered-comparison-oracle.js'
import type { PageRow } from './pagination-support.js'
import type { PublicPageRow } from './pagination-fixtures.js'
import type { LoadSubsetOptions } from '../../src/types.js'

export type PaginationWindow = {
  offset: number
  limit: number
}

export type PaginationAction =
  | ({ type: `window` } & PaginationWindow)
  | { type: `put`; id: number; rank: number; keep?: boolean }
  | { type: `delete`; id: number }

export type PaginationStateScenario = {
  ranks: ReadonlyArray<number>
  keeps?: ReadonlyArray<boolean>
  direction: `asc` | `desc`
  initialWindow: PaginationWindow
  actions: ReadonlyArray<PaginationAction>
  explicitPublicKeyOrder?: boolean
  includeFilter?: boolean
  reverseInsertion?: boolean
}

export type PendingMutation =
  | { type: `insert`; row: PageRow }
  | { type: `delete`; id: number }
  | { type: `update`; row: PageRow }

export type PendingMutationScenario = {
  ranks: ReadonlyArray<number>
  direction: `asc` | `desc`
  limit: number
  mutation: PendingMutation
  responseOutcome: `resolve` | `reject`
  includeFilter?: boolean
  /** Provider response cap; the recorded request retains its requested limit. */
  orderedResponseLimit?: number
}

export type PendingMutationResult = {
  mutationRepairRequests: Array<LoadSubsetOptions>
  releasedBeforeCleanup: Array<LoadSubsetOptions>
}

export function orderSignature(options: LoadSubsetOptions) {
  return options.orderBy?.map(({ expression, compareOptions }) => ({
    path: expression instanceof PropRef ? expression.path : undefined,
    direction: compareOptions.direction,
  }))
}

export function expectedOrderSignature(
  direction: `asc` | `desc`,
  explicitPublicKeyOrder: boolean,
) {
  return [
    { path: [`rank`], direction },
    ...(explicitPublicKeyOrder
      ? [{ path: [`id`], direction: `asc` as const }]
      : []),
  ]
}

export function expectPredicateBehavior(
  where: LoadSubsetOptions[`where`],
  accepted: ReadonlyArray<PageRow>,
  rejected: ReadonlyArray<PageRow>,
) {
  compareAt(`pagination-oracle.property.test.ts:214`, () =>
    expect(where).toBeDefined(),
  )
  for (const row of accepted) {
    compareAt(`pagination-oracle.property.test.ts:216`, () =>
      expect(evaluateReferenceExpression(where!, row)).toBe(true),
    )
  }
  for (const row of rejected) {
    compareAt(`pagination-oracle.property.test.ts:219`, () =>
      expect(evaluateReferenceExpression(where!, row)).not.toBe(true),
    )
  }
}

export function classifyWhereOnlyRepairRequest(
  request: LoadSubsetOptions,
  scenario: PendingMutationScenario,
): `tie` | `filtered-full-source` {
  if (!request.where || request.orderBy || request.limit || request.cursor) {
    throw new Error(`Expected one predicate-only repair request`)
  }
  if (!scenario.includeFilter) return `tie`

  const distantMatchingRows: ReadonlyArray<PageRow> = [
    { id: 101, rank: -1_000_000, keep: true },
    { id: 102, rank: 1_000_000, keep: true },
  ]
  const acceptsWholeFilteredSource = distantMatchingRows.every(
    (row) => evaluateReferenceExpression(request.where!, row) === true,
  )
  return acceptsWholeFilteredSource ? `filtered-full-source` : `tie`
}

export function expectFilteredBoundedRepairTrace(
  result: PendingMutationResult,
  direction: `asc` | `desc`,
  limit: number,
) {
  expect(result.mutationRepairRequests).toHaveLength(2)
  const [prefix, boundary] = result.mutationRepairRequests
  expect(orderSignature(prefix!)).toStrictEqual(
    expectedOrderSignature(direction, true),
  )
  expect(prefix!.limit).toBe(limit)
  expect(prefix!.refetch).toBe(true)
  expect(prefix!.cursor).toBeUndefined()
  expect(prefix!.offset).toBeUndefined()
  expectPredicateBehavior(
    prefix!.where,
    [{ id: 10, rank: -100, keep: true }],
    [{ id: 10, rank: -100, keep: false }],
  )

  expect(boundary!.orderBy).toBeUndefined()
  expect(boundary!.limit).toBeUndefined()
  expect(boundary!.refetch).toBe(true)
  expect(boundary!.cursor).toBeUndefined()
  expect(boundary!.offset).toBeUndefined()
  expectPredicateBehavior(
    boundary!.where,
    [{ id: 4, rank: 3, keep: true }],
    [
      { id: 4, rank: 2, keep: true },
      { id: 4, rank: 3, keep: false },
    ],
  )
}

export function referenceWindow(
  rows: ReadonlyArray<PageRow>,
  direction: `asc` | `desc`,
  window: PaginationWindow,
): Array<number> {
  return referenceWindowRows(rows, direction, window).map(({ id }) => id)
}

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

export function expectWindowRows(
  actual: ReadonlyArray<PublicPageRow>,
  expected: ReadonlyArray<PublicPageRow>,
): void {
  compareAt(`pagination-oracle.property.test.ts:640`, () =>
    expect(actual).toEqual(expected),
  )
}

export function visibleRows(
  rows: ReadonlyArray<PageRow>,
  includeFilter: boolean | undefined,
): Array<PageRow> {
  return includeFilter ? rows.filter(({ keep }) => keep) : [...rows]
}

// The eager NaN window cells. The oracle replays each through
// runPaginationScenario; pagination-model.test.ts checks the model against
// the stated ids.
export const eagerNaNWindowCases = [
  {
    direction: `asc` as const,
    ranks: [10, 20, NaN, 30, 40],
    expectedIds: [1, 2, 4],
    limit: 3,
  },
  {
    direction: `desc` as const,
    ranks: [10, 20, NaN, 30, 40],
    expectedIds: [3, 5, 4],
    limit: 3,
  },
  {
    direction: `desc` as const,
    ranks: [10, NaN, 20],
    expectedIds: [2, 3],
    limit: 2,
  },
  {
    direction: `desc` as const,
    ranks: [NaN, 20, NaN, 30],
    expectedIds: [1, 3, 4],
    limit: 3,
  },
  {
    direction: `desc` as const,
    ranks: [10, 20, 25, 30, 40],
    expectedIds: [5, 4, 3],
    limit: 3,
  },
]

// Rows entering and leaving the filter. The oracle replays each through
// runPaginationStateScenario; pagination-model.test.ts checks the model's
// final window against the stated ids.
export const filterUpdateCases = [
  {
    name: `enters the filter`,
    keeps: [false, true],
    action: { type: `put` as const, id: 1, rank: 0, keep: true },
    expected: [1, 2],
  },
  {
    name: `leaves the filter`,
    keeps: [true, true],
    action: { type: `put` as const, id: 1, rank: 0, keep: false },
    expected: [2],
  },
]

export function filterUpdateScenario({
  keeps,
  action,
}: (typeof filterUpdateCases)[number]): PaginationStateScenario {
  return {
    ranks: [0, 1],
    keeps,
    direction: `asc`,
    includeFilter: true,
    explicitPublicKeyOrder: true,
    reverseInsertion: false,
    initialWindow: { offset: 0, limit: 2 },
    actions: [action],
  }
}
