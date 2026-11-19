/**
 * Model and checker calibrations for `pagination-oracle.property.test.ts`.
 * They run no production: each checks that the independent window model gives
 * the stated ids, or that a request-trace check or classifier rejects or
 * classifies a hand-built input. The law, its authority, and the production
 * comparisons are in that oracle file; the model and checks are in
 * `pagination-model-oracle.ts`. The model cases' production runs replay through
 * the oracle's `pagination.ordered-window-fixed` and
 * `pagination.window-transition-fixed` properties.
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from '../../src/query/builder/functions.js'
import { PropRef } from '../../src/query/ir.js'
import {
  classifyWhereOnlyRepairRequest,
  eagerNaNWindowCases,
  expectFilteredBoundedRepairTrace,
  expectWindowRows,
  filterUpdateCases,
  filterUpdateScenario,
  referenceWindow,
  referenceWindowRows,
  visibleRows,
} from './pagination-model-oracle.js'
import type {
  PendingMutationResult,
  PendingMutationScenario,
} from './pagination-model-oracle.js'

describe(`pagination model`, () => {
  it.each(eagerNaNWindowCases)(
    `orders a $direction eager window with a NaN or finite middle rank`,
    ({ direction, ranks, expectedIds, limit }) => {
      const rows = ranks.map((rank, index) => ({ id: index + 1, rank }))
      const modeled = referenceWindow(rows, direction, { offset: 0, limit })
      expect(modeled).toEqual(expectedIds)
    },
  )

  it.each(filterUpdateCases)(`updates a row that $name`, (row) => {
    const { keeps, action, expected } = row
    const scenario = filterUpdateScenario(row)

    const finalRows = scenario.ranks.map((rank, index) => ({
      id: index + 1,
      rank,
      keep: index === 0 ? action.keep : keeps[index],
    }))
    expect(
      referenceWindow(
        visibleRows(finalRows, true),
        scenario.direction,
        scenario.initialWindow,
      ),
    ).toEqual(expected)
  })

  it(`rejects the right NaN window members in the wrong order`, () => {
    const rows = [
      { id: 1, rank: 10 },
      { id: 2, rank: 20 },
      { id: 3, rank: NaN },
      { id: 4, rank: 30 },
      { id: 5, rank: 40 },
    ]
    const expected = referenceWindowRows(rows, `desc`, { offset: 0, limit: 3 })
    expect(expected.map(({ id }) => id)).toEqual([3, 5, 4])
    expect(() =>
      expectWindowRows([expected[1]!, expected[2]!, expected[0]!], expected),
    ).toThrow()
  })

  it(`rejects a malformed bounded-repair request trace`, () => {
    const malformed: PendingMutationResult = {
      mutationRepairRequests: [
        {
          orderBy: [
            {
              expression: new PropRef([`wrongPrimary`]),
              compareOptions: { direction: `desc`, nulls: `last` },
            },
            {
              expression: new PropRef([`wrongSecondary`]),
              compareOptions: { direction: `desc`, nulls: `last` },
            },
          ],
          limit: 3,
          offset: 99,
          refetch: true,
        },
        { refetch: true },
      ],
      releasedBeforeCleanup: [],
    }

    expect(() =>
      expectFilteredBoundedRepairTrace(malformed, `asc`, 3),
    ).toThrow()
  })

  it(`distinguishes a filtered full-source fallback from a repair tie predicate`, () => {
    const filter = eq(new PropRef([`keep`]), true)
    const scenario: PendingMutationScenario = {
      ranks: [0, 1, 2],
      direction: `asc`,
      limit: 2,
      mutation: { type: `delete`, id: 1 },
      responseOutcome: `reject`,
      includeFilter: true,
    }

    expect(classifyWhereOnlyRepairRequest({ where: filter }, scenario)).toBe(
      `filtered-full-source`,
    )
    expect(
      classifyWhereOnlyRepairRequest(
        {
          where: and(filter, eq(new PropRef([`rank`]), 1)),
        },
        scenario,
      ),
    ).toBe(`tie`)
  })
})
