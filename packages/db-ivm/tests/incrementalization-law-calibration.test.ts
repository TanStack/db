// Calibrations of the DBSP incrementalization oracle's grammar and checker.
// They run the grammar and the shared law checker, not a production campaign:
// the census samples the fixed ordered campaign of
// incrementalization-law-oracle.property.test.ts (the same seed and run
// count), and each fault control plants a wrong operator graph or an illegal
// input state that the checker must reject.
import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import {
  consolidate,
  filter,
  groupBy,
  groupByOperators,
  map,
  orderByWithFractionalIndex,
  reduce,
} from '../src/operators/index.js'
import { oracleFixedSeed, oracleRuns } from '../../db/tests/oracle-config.js'
import { assertUnaryIncrementalization } from './incrementalization-law-oracle.js'
import {
  firstThree,
  firstTwoPerParity,
  groupedAggregates,
  groupedPolicy,
  keyedIdentity,
  keyedPolicy,
  orderedHistory,
  uniqueRowSplitDomain,
  withoutIndex,
  withoutPromotion,
} from './incrementalization-law-domain-oracle.js'
import type { Weighted } from './incrementalization-law-oracle.js'
import type { Keyed } from './incrementalization-law-domain-oracle.js'

const FIXED_SEED = 1741
const RUNS = oracleRuns(100)

describe(`DBSP incrementalization laws`, () => {
  // Reconstruction: the fixed ordered campaign reaches promotion. Sampling
  // its arbitrary with its seed and run count yields exactly the histories it
  // executes. A promotion is a transition after which a window holds a row
  // that the previous world held, unchanged, outside the window: a removal
  // or displacement promoted it. Only a window that already holds its limit
  // can promote, so worlds too small to fill it would lose this law while
  // every comparison still passed.
  it(`generates ordered histories that promote retained rows`, () => {
    const promotions = { global: 0, perParity: 0 }
    const promoted = (
      window: (rows: Weighted<Keyed>) => Weighted<Keyed>,
      previous: Weighted<Keyed>,
      next: Weighted<Keyed>,
    ) => {
      const before = new Set(window(previous).map(([row]) => String(row)))
      const held = new Set(previous.map(([row]) => String(row)))
      return window(next).some(
        ([row]) => held.has(String(row)) && !before.has(String(row)),
      )
    }
    for (const [worlds] of fc.sample(
      fc.tuple(orderedHistory),
      oracleFixedSeed(FIXED_SEED, { numRuns: RUNS }),
    )) {
      for (const [index, next] of worlds.slice(1).entries()) {
        const previous = worlds[index]!
        if (promoted(firstThree, previous, next)) promotions.global++
        if (promoted(firstTwoPerParity, previous, next)) promotions.perParity++
      }
    }
    // At 100 runs: 25 global and 21 per-parity promotions; independent
    // worlds alone gave 2 and 2.
    expect(promotions.global).toBeGreaterThanOrEqual(10)
    expect(promotions.perParity).toBeGreaterThanOrEqual(10)
  })

  it(`rejects invalid negative and duplicate-key input states`, () => {
    // A checker calibration: a failure here is the framework's, not a kill.
    expect(() =>
      assertUnaryIncrementalization({
        name: `negative input state excluded`,
        initial: [[[0, 1], -1]],
        batches: [],
        inputPolicy: keyedPolicy,
        outputPolicy: keyedPolicy,
        build: (input) => input.pipe(consolidate()),
        evaluate: keyedIdentity,
      }),
    ).toThrow(/illegal negative input state/)

    expect(() =>
      assertUnaryIncrementalization({
        name: `duplicate unique row key excluded`,
        initial: [
          [[0, 1], 1],
          [[0, 2], 1],
        ],
        batches: [],
        inputPolicy: keyedPolicy,
        outputPolicy: keyedPolicy,
        splitDomain: uniqueRowSplitDomain,
        build: (input) => input.pipe(consolidate()),
        evaluate: keyedIdentity,
      }),
    ).toThrow(/no unit ordering with legal split-delivery prefixes/)
  })

  it(`rejects omitted, sign-flipped, wrong-member, wrong-window, wrong-limit, missing-promotion, and truthiness-filtered output`, () => {
    expect(() =>
      assertUnaryIncrementalization({
        name: `omitted output fault`,
        initial: [[[0, 1], 1]],
        batches: [],
        inputPolicy: keyedPolicy,
        outputPolicy: keyedPolicy,
        build: (input) => input.pipe(filter(() => false)),
        evaluate: keyedIdentity,
      }),
    ).toThrow(/output delta diverged/)
    expect(() =>
      assertUnaryIncrementalization({
        name: `sign-flipped weight fault`,
        initial: [[[0, 1], 1]],
        batches: [],
        inputPolicy: keyedPolicy,
        outputPolicy: keyedPolicy,
        // A reduce that negates every multiplicity flips the sign of each row.
        build: (input) =>
          input.pipe(
            reduce((values) =>
              values.map(([value, weight]) => [value, -weight] as const),
            ),
          ),
        evaluate: keyedIdentity,
      }),
    ).toThrow(/output delta diverged/)
    expect(() =>
      assertUnaryIncrementalization({
        name: `wrong member fault`,
        initial: [[[0, 1], 1]],
        batches: [],
        inputPolicy: keyedPolicy,
        outputPolicy: keyedPolicy,
        build: (input) =>
          input.pipe(map(([key, value]) => [key, value + 1] as Keyed)),
        evaluate: keyedIdentity,
      }),
    ).toThrow(/output delta diverged/)
    expect(() =>
      assertUnaryIncrementalization({
        name: `wrong window fault`,
        initial: [
          [[0, 0], 1],
          [[1, 1], 1],
          [[2, 2], 1],
          [[3, 3], 1],
        ],
        batches: [],
        inputPolicy: keyedPolicy,
        outputPolicy: keyedPolicy,
        build: (input) =>
          input.pipe(
            orderByWithFractionalIndex((rank) => rank, {
              comparator: (left, right) => right - left,
              limit: 3,
            }),
            withoutIndex(),
          ),
        evaluate: firstThree,
      }),
    ).toThrow(/output delta diverged/)
    expect(() =>
      assertUnaryIncrementalization({
        name: `wrong window limit fault`,
        initial: [
          [[0, 1] as Keyed, 1],
          [[1, 2] as Keyed, 1],
          [[2, 3] as Keyed, 1],
        ],
        batches: [],
        inputPolicy: keyedPolicy,
        outputPolicy: keyedPolicy,
        build: (input) =>
          input.pipe(
            orderByWithFractionalIndex((rank) => rank, { limit: 3 }),
            withoutIndex(),
          ),
        evaluate: (input) => firstThree(input).slice(0, 2),
      }),
    ).toThrow(/output delta diverged at checkpoint 0/)
    // On the promotion history, the same wrong limit agrees with the model
    // until the third value arrives past the boundary.
    expect(() =>
      assertUnaryIncrementalization({
        name: `wrong promotion limit fault`,
        initial: [
          [[0, 1] as Keyed, 1],
          [[1, 2] as Keyed, 1],
        ],
        batches: [[[[2, 3] as Keyed, 1]], [[[0, 1] as Keyed, -1]]],
        inputPolicy: keyedPolicy,
        outputPolicy: keyedPolicy,
        build: (input) =>
          input.pipe(
            orderByWithFractionalIndex((rank) => rank, { limit: 3 }),
            withoutIndex(),
          ),
        evaluate: (input) => firstThree(input).slice(0, 2),
      }),
    ).toThrow(/output delta diverged at checkpoint 1/)
    // A window that removes the first value without promoting the third
    // agrees with the model until the removal.
    expect(() =>
      assertUnaryIncrementalization({
        name: `missing promotion fault`,
        initial: [
          [[0, 1] as Keyed, 1],
          [[1, 2] as Keyed, 1],
        ],
        batches: [[[[2, 3] as Keyed, 1]], [[[0, 1] as Keyed, -1]]],
        inputPolicy: keyedPolicy,
        outputPolicy: keyedPolicy,
        build: (input) =>
          input.pipe(
            orderByWithFractionalIndex((rank) => rank, { limit: 2 }),
            withoutPromotion(),
            withoutIndex(),
          ),
        evaluate: (input) => firstThree(input).slice(0, 2),
      }),
    ).toThrow(/output delta diverged at checkpoint 2/)

    const truthinessMinimum = {
      preMap: ([, value]: Keyed): number | undefined => value,
      reduce: (values: Array<[number | undefined, number]>) => {
        let minimum: number | undefined
        for (const [value] of values) {
          if (!minimum || (value !== undefined && value && value < minimum)) {
            minimum = value
          }
        }
        return minimum
      },
      postMap: (result: number | undefined) => result,
    }
    const truthinessMaximum = {
      preMap: ([, value]: Keyed): number | undefined => value,
      reduce: (values: Array<[number | undefined, number]>) => {
        let maximum: number | undefined
        for (const [value] of values) {
          if (!maximum || (value !== undefined && value && value > maximum)) {
            maximum = value
          }
        }
        return maximum
      },
      postMap: (result: number | undefined) => result,
    }
    expect(() =>
      assertUnaryIncrementalization({
        name: `truthiness-filtered extrema fault`,
        initial: [
          [[0, 5], 1],
          [[2, 0], 1],
          [[1, -2], 1],
          [[3, 0], 1],
        ],
        batches: [],
        inputPolicy: keyedPolicy,
        outputPolicy: groupedPolicy,
        splitDomain: uniqueRowSplitDomain,
        build: (input) =>
          input.pipe(
            groupBy(([key]) => ({ bucket: key % 2 }), {
              total: groupByOperators.sum(([, value]) => value),
              minimum: truthinessMinimum,
              maximum: truthinessMaximum,
              mean: groupByOperators.avg(([, value]) => value),
            }),
          ),
        evaluate: groupedAggregates,
      }),
    ).toThrow(/output delta diverged/)
  })
})
