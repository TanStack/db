import { setImmediate } from 'node:timers/promises'
import { fc } from '@fast-check/vitest'
import { afterEach, beforeEach, describe, expect } from 'vitest'
import { isGeneratedOracleCampaign } from '../../db/tests/oracle-config.js'
import {
  consolidate,
  groupBy,
  groupByOperators,
  groupedOrderByWithFractionalIndex,
  join,
  map,
  orderByWithFractionalIndex,
  reduce,
} from '../src/operators/index.js'
import {
  differs,
  oracleProperty,
  pass,
} from '../../db/tests/oracle-property.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter.js'
import {
  assertBinaryIncrementalization,
  assertUnaryIncrementalization,
  weightedDifference,
} from './incrementalization-law-oracle.js'
import {
  CANCELLATION_ROW,
  firstThree,
  firstTwoPerParity,
  fullJoined,
  groupedAggregates,
  groupedMean,
  groupedMeanPolicy,
  groupedPolicy,
  groupedTextExtrema,
  groupedTextPolicy,
  innerJoined,
  joinPolicy,
  joined,
  joinedSums,
  keyedIdentity,
  keyedPolicy,
  leftJoined,
  orderedHistory,
  outerJoinPolicy,
  rightJoined,
  summed,
  textPair,
  transitions,
  uniqueRowSplitDomain,
  weightedWorld,
  withoutIndex,
} from './incrementalization-law-domain-oracle.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'
import type { Arbitrary } from 'fast-check'
import type {
  IncrementalizationComparisonRecorder,
  IncrementalizationReach,
} from './incrementalization-law-oracle.js'
import type { Keyed } from './incrementalization-law-domain-oracle.js'

/**
 * # Does incremental execution equal full recomputation?
 *
 * D2 operators keep state and emit only changes. A wrong delta can leave the
 * final rows looking right after a later batch, so final-state examples are not
 * enough. The package README defines MultiSet data as signed changes. The DBSP
 * accumulation/difference law in docs/contributing/oracle-rubric.md authorizes
 * comparison of the net emitted delta and retained relation with a direct
 * recomputation after each logical batch. It does not specify message order,
 * client publication, or readiness.
 *
 * The plain evaluators below define the expected relations for reductions,
 * joins, groups, and ordered windows. They use arrays and Maps, not D2
 * operators. The shared checker then delivers each generated logical change as
 * one atomic batch and as legal one-row steps.
 *
 * The generated domain uses small JSON tuples with integer weights. Named
 * cases force empty batches, duplicate weights, replacements, cancellation,
 * presence changes, falsey group extrema, boundary ties, and a zero-width
 * window. Fault controls prove that the checker rejects missing, sign-flipped,
 * wrong-member, and truthiness-filtered aggregate output.
 *
 * Grammar calibration: a world is a complete logical input relation in this
 * model. A transition is its signed difference delivered to the production D2
 * input stream. Weighted worlds contain 0-8 records, keys 0-3, values -3..3,
 * and positive weights 1-2; histories contain 2-7 worlds. Repeated records
 * give multiplicity, while the fixed cancellation pair adds a net-zero
 * batch even when adjacent worlds match. Binary worlds vary independently so
 * matching and unmatched keys can coexist. Ordered worlds contain 0-8 unique
 * keys 0-7 and distinct ranks -20..20; that constraint makes each split prefix
 * a legal unique-row relation. Most ordered steps edit the previous world by
 * one removal or insertion, so a window row leaves while the next row stays,
 * and a reconstruction check counts those promotions over the executed fixed
 * campaign. Each generated campaign also sums the checker's delivery counts
 * and requires split delivery to take more steps than an unsplit run. The named witnesses below reconstruct empty,
 * repeated, replacement, presence-flip, falsey-extrema, and window-boundary
 * cases even if a fixed/random campaign misses them. Removing multiplicity
 * loses duplicate-weight cases; removing independent binary sides loses
 * presence flips; removing split delivery loses replacement-prefix checks;
 * removing the named tie case loses the equal-rank boundary. Negative retained
 * input weights and two occupied values for one unique row key are rejected
 * below. Weight 3 or rank 21 would only widen a numeric range. Arbitrary rank
 * ties would change the distinct-rank rule; non-JSON identities need another
 * value policy. Neither arbitrary ties nor intermediate message order is a
 * generated claim here.
 *
 * Before this repair the groupBy branch observed only sums. Truthiness defects
 * in `min` and `max` were therefore outside both its model and its assertions.
 * The small direct reducer cases remain readable replay witnesses; this suite
 * owns the generated incremental-versus-recompute law.
 */

/**
 * Reach of one generated campaign. The checker delivers every logical batch
 * twice: as one atomic batch, and as legal one-row steps. The split law says
 * something only when some batch actually took several steps, so a generator
 * or checker change that stopped splitting would leave it vacuous while every
 * comparison still passed. Each campaign therefore sums the checker's own
 * delivery counts over the histories it ran, and requires one atomic delivery
 * per checkpoint and more split deliveries than an unsplit run makes: one per
 * unary checkpoint, and two per binary checkpoint, whose split path always
 * sends each side on its own.
 */
class CampaignReach {
  constructor(
    private readonly observeComparison?: IncrementalizationComparisonRecorder,
  ) {}
  private atomicCheckpoints = 0
  private atomicDeliveries = 0
  private splitCheckpoints = 0
  private splitDeliveries = 0
  private unsplitDeliveries = 0

  unary: typeof assertUnaryIncrementalization = (law) =>
    this.add(
      assertUnaryIncrementalization({
        ...law,
        observeComparison: this.observeComparison,
      }),
      1,
    )

  binary: typeof assertBinaryIncrementalization = (law) =>
    this.add(
      assertBinaryIncrementalization({
        ...law,
        observeComparison: this.observeComparison,
      }),
      2,
    )

  expectBothDeliveries(): void {
    expect(this.atomicCheckpoints, `atomic checkpoints`).toBeGreaterThan(0)
    expect(this.atomicDeliveries, `one atomic delivery per checkpoint`).toBe(
      this.atomicCheckpoints,
    )
    expect(
      this.splitDeliveries,
      `split deliveries beyond an unsplit run`,
    ).toBeGreaterThan(this.unsplitDeliveries)
  }

  private add(
    reach: IncrementalizationReach,
    inputs: 1 | 2,
  ): IncrementalizationReach {
    this.unsplitDeliveries += inputs * reach.splitCheckpoints
    this.atomicCheckpoints += reach.atomicCheckpoints
    this.atomicDeliveries += reach.atomicDeliveries
    this.splitCheckpoints += reach.splitCheckpoints
    this.splitDeliveries += reach.splitDeliveries
    return reach
  }
}

/**
 * The model observes relation membership and multiplicity. The ordered
 * window operators also annotate each selected member with a fractional
 * index, which these laws drop before comparing. Publication timing and
 * SQL meaning are separate contracts.
 *
 * Normal runs pair a stable campaign with a new random seed. A replay of this
 * property selects only its recorded seed and shrink path.
 */

// The independent recomputations remain in the shared law checker. Native
// registration records its actual/reference pairs and preserves its original
// fail-fast error, including errors that are unrelated to a comparison.
type Comparison = {
  law: string
  actual: Array<[string, number]>
  expected: Array<[string, number]>
}
function incrementalizationReferences(
  _history: unknown,
  trace: ReadonlyArray<Observation>,
) {
  return trace.map(({ value }) => (value as Comparison).expected)
}
function checkIncrementalization(
  _history: unknown,
  trace: ReadonlyArray<Observation>,
  expected: Array<Array<[string, number]>>,
): Verdict {
  for (const [at, { checkpoint, value }] of trace.entries()) {
    const comparison = value as Comparison
    // Preserve the shared checker's JSON-normalized relation comparison.
    const mismatch = differs(
      checkpoint,
      comparison.law,
      JSON.stringify(comparison.actual),
      JSON.stringify(expected[at]),
    )
    if (mismatch) return mismatch
  }
  return pass
}

function registerIncrementalization<T>(
  name: string,
  arbitrary: Arbitrary<T>,
  drive: (history: T, reach: CampaignReach) => Promise<void>,
) {
  describe(name, () => {
    let reach: CampaignReach
    let observeComparison: IncrementalizationComparisonRecorder | undefined
    beforeEach(() => {
      reach = new CampaignReach((checkpoint, value) =>
        observeComparison?.(checkpoint, value),
      )
    })
    // Preserve the original per-campaign aggregate delivery guard. The native
    // determinism check samples histories separately and is not a campaign.
    afterEach(({ task }) => {
      if (isGeneratedOracleCampaign(task.name) && !task.result?.errors?.length)
        reach.expectBothDeliveries()
    })
    oracleProperty<T, Array<Array<[string, number]>>>({
      id: `ivm.incrementalization-law`,
      law: {
        statement: name,
        authority: `The existing DBSP accumulation/difference law and direct evaluators documented above.`,
        limits: `The original bounded JSON relation, delivery and operator domains; message order and client publication remain outside this owner.`,
      },
      owns: [
        `src/operators/map.ts#map`,
        `src/operators/filter.ts#filter`,
        `src/operators/consolidate.ts#consolidate`,
        `src/operators/reduce.ts#reduce`,
        `src/operators/groupBy.ts#groupBy`,
        `src/operators/join.ts#join`,
        `src/operators/orderBy.ts#orderByWithFractionalIndex`,
        `src/operators/groupedOrderBy.ts#groupedOrderByWithFractionalIndex`,
      ],
      histories: { arbitrary, runs: 100, fixedSeeds: [1741] },
      model: incrementalizationReferences,
      driver: async (history, observe) => {
        observeComparison = observe
        try {
          await drive(history, reach)
        } finally {
          observeComparison = undefined
        }
      },
      check: checkIncrementalization,
    })
  })
}

// The named cells force empty batches, duplicate weights, replacements,
// cancellation, presence flips, falsey group extrema, boundary ties, a
// zero-width window, and a promotion even if a generated campaign misses
// them. Each runs through the shared law checker, and the checker's delivery
// counts are compared with the counts that each cell's batches imply.
function replayNamedCells(): void {
  const unaryReach = assertUnaryIncrementalization({
    name: `named unary cells`,
    initial: [],
    batches: [
      [
        [CANCELLATION_ROW, -1],
        [CANCELLATION_ROW, 1],
      ],
      [[[0, 1], 2]],
      [
        [[0, 1], -2],
        [[0, 2], 1],
      ],
      [[[0, 2], -1]],
    ],
    inputPolicy: keyedPolicy,
    outputPolicy: keyedPolicy,
    build: (input) => input.pipe(consolidate()),
    evaluate: keyedIdentity,
  })
  expect(unaryReach).toEqual({
    atomicCheckpoints: 5,
    atomicDeliveries: 5,
    splitCheckpoints: 5,
    splitDeliveries: 6,
  })

  const binaryReach = assertBinaryIncrementalization({
    name: `named outer-join presence cells`,
    initialLeft: [[[0, 1], 1]],
    initialRight: [],
    batches: [
      { left: [], right: [[[0, 2], 1]] },
      {
        left: [[[0, 1], -1]],
        right: [[[0, 2], -1]],
      },
    ],
    leftPolicy: keyedPolicy,
    rightPolicy: keyedPolicy,
    outputPolicy: outerJoinPolicy,
    build: (left, right) => left.pipe(join(right, `full`)),
    evaluate: fullJoined,
  })
  expect(binaryReach).toEqual({
    atomicCheckpoints: 3,
    atomicDeliveries: 3,
    splitCheckpoints: 3,
    splitDeliveries: 4,
  })

  const extremaReach = assertUnaryIncrementalization({
    name: `grouped falsey extrema`,
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
          minimum: groupByOperators.min(([, value]) => value),
          maximum: groupByOperators.max(([, value]) => value),
          mean: groupByOperators.avg(([, value]) => value),
        }),
      ),
    evaluate: groupedAggregates,
  })
  expect(extremaReach).toEqual({
    atomicCheckpoints: 1,
    atomicDeliveries: 1,
    splitCheckpoints: 1,
    splitDeliveries: 4,
  })

  assertUnaryIncrementalization({
    name: `grouped-order boundary tie`,
    initial: [
      [[4, 1], 1],
      [[2, 1], 1],
      [[0, 1], 1],
    ],
    batches: [],
    inputPolicy: keyedPolicy,
    outputPolicy: keyedPolicy,
    splitDomain: uniqueRowSplitDomain,
    build: (input) =>
      input.pipe(
        groupedOrderByWithFractionalIndex((rank) => rank, {
          groupKeyFn: (key) => key % 2,
          limit: 2,
        }),
        map(([key, [rank]]) => [key, rank] as Keyed),
      ),
    evaluate: firstTwoPerParity,
  })

  assertUnaryIncrementalization({
    name: `grouped-order replacement uses legal split prefixes`,
    initial: [[[6, 0], 1]],
    // Deliberately put the insertion first. The split scheduler must retract
    // the occupied unique row key before it can deliver the replacement.
    batches: [
      [
        [[6, -1], 1],
        [[6, 0], -1],
      ],
    ],
    inputPolicy: keyedPolicy,
    outputPolicy: keyedPolicy,
    splitDomain: uniqueRowSplitDomain,
    build: (input) =>
      input.pipe(
        groupedOrderByWithFractionalIndex((rank) => rank, {
          groupKeyFn: (key) => key % 2,
          limit: 2,
        }),
        map(([key, [rank]]) => [key, rank] as Keyed),
      ),
    evaluate: firstTwoPerParity,
  })

  assertUnaryIncrementalization({
    name: `zero-width order window`,
    initial: [
      [[0, 0], 1],
      [[1, 1], 1],
    ],
    batches: [],
    inputPolicy: keyedPolicy,
    outputPolicy: keyedPolicy,
    splitDomain: uniqueRowSplitDomain,
    build: (input) =>
      input.pipe(
        orderByWithFractionalIndex((rank) => rank, { limit: 0 }),
        withoutIndex(),
      ),
    evaluate: () => [],
  })

  // The adjacent width-one case admits exactly the first ranked value.
  assertUnaryIncrementalization({
    name: `one-width order window`,
    initial: [
      [[0, 0], 1],
      [[1, 1], 1],
    ],
    batches: [],
    inputPolicy: keyedPolicy,
    outputPolicy: keyedPolicy,
    splitDomain: uniqueRowSplitDomain,
    build: (input) =>
      input.pipe(
        orderByWithFractionalIndex((rank) => rank, { limit: 1 }),
        withoutIndex(),
      ),
    evaluate: (input) => firstThree(input).slice(0, 1),
  })

  // At two values, limit 2 retains both. The third value lands past the
  // boundary; a wrong limit of 3 would leak it at checkpoint 1. Removing the
  // first value then requires the third to enter the window.
  const promotion = assertUnaryIncrementalization({
    name: `ordered window boundary and promotion`,
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
        withoutIndex(),
      ),
    evaluate: (input) => firstThree(input).slice(0, 2),
  })
  expect(promotion).toEqual({
    atomicCheckpoints: 3,
    atomicDeliveries: 3,
    splitCheckpoints: 3,
    splitDeliveries: 4,
  })
}

const NAMED_CELLS_LAW = `Every named cell's emitted delta and retained output equal full recomputation under atomic and split delivery.`

describe(`DBSP incrementalization laws`, () => {
  registerIncrementalization(
    `checks consolidate, reduce, and groupBy against full recomputation`,
    fc.array(weightedWorld, { minLength: 2, maxLength: 7 }),
    async (worlds, reach) => {
      // Yield between complete histories so stress runs can report progress.
      // Graph delivery and every observation within a history stay synchronous.
      await setImmediate()
      const batches = transitions(worlds)
      reach.unary({
        name: `consolidate`,
        initial: worlds[0]!,
        batches,
        inputPolicy: keyedPolicy,
        outputPolicy: keyedPolicy,
        build: (input) => input.pipe(consolidate()),
        evaluate: keyedIdentity,
      })
      reach.unary({
        name: `reduce`,
        initial: worlds[0]!,
        batches,
        inputPolicy: keyedPolicy,
        outputPolicy: keyedPolicy,
        build: (input) =>
          input.pipe(
            reduce((values) => {
              if (values.length === 0) return []
              return [
                [
                  values.reduce(
                    (sum, [value, weight]) => sum + value * weight,
                    0,
                  ),
                  1,
                ],
              ]
            }),
          ),
        evaluate: summed,
      })
      reach.unary({
        name: `groupBy reduction`,
        initial: worlds[0]!,
        batches,
        inputPolicy: keyedPolicy,
        outputPolicy: groupedPolicy,
        build: (input) =>
          input.pipe(
            groupBy(([key]) => ({ bucket: key % 2 }), {
              total: groupByOperators.sum(([, value]) => value),
              minimum: groupByOperators.min(([, value]) => value),
              maximum: groupByOperators.max(([, value]) => value),
              mean: groupByOperators.avg(([, value]) => value),
            }),
          ),
        evaluate: groupedAggregates,
      })
      reach.unary({
        name: `groupBy mean alone`,
        initial: worlds[0]!,
        batches,
        inputPolicy: keyedPolicy,
        outputPolicy: groupedMeanPolicy,
        build: (input) =>
          input.pipe(
            groupBy(([key]) => ({ bucket: key % 2 }), {
              mean: groupByOperators.avg(([, value]) => value),
            }),
          ),
        evaluate: groupedMean,
      })
      reach.unary({
        name: `groupBy string extrema`,
        initial: worlds[0]!,
        batches,
        inputPolicy: keyedPolicy,
        outputPolicy: groupedTextPolicy,
        build: (input) =>
          input.pipe(
            groupBy(([key]) => ({ bucket: key % 2 }), {
              lowFirst: groupByOperators.min(([, value]) => textPair(value)[0]),
              highFirst: groupByOperators.max(
                ([, value]) => textPair(value)[0],
              ),
              lowSecond: groupByOperators.min(
                ([, value]) => textPair(value)[1],
              ),
              highSecond: groupByOperators.max(
                ([, value]) => textPair(value)[1],
              ),
            }),
          ),
        evaluate: groupedTextExtrema,
      })
    },
  )

  registerIncrementalization(
    `checks simultaneous binary join deltas and split delivery`,
    fc.array(fc.tuple(weightedWorld, weightedWorld), {
      minLength: 2,
      maxLength: 7,
    }),
    async (generated, reach) => {
      await setImmediate()
      const worlds = generated.map(([left, right]) => ({ left, right }))
      const batches = worlds.slice(1).map((next, index) => ({
        left: weightedDifference(
          worlds[index]!.left,
          next.left,
          keyedPolicy,
          CANCELLATION_ROW,
        ),
        right: weightedDifference(
          worlds[index]!.right,
          next.right,
          keyedPolicy,
          CANCELLATION_ROW,
        ),
      }))
      reach.binary({
        name: `inner join`,
        initialLeft: worlds[0]!.left,
        initialRight: worlds[0]!.right,
        batches,
        leftPolicy: keyedPolicy,
        rightPolicy: keyedPolicy,
        outputPolicy: joinPolicy,
        build: (left, right) => left.pipe(innerJoined(right)),
        evaluate: joined,
      })
      reach.binary({
        name: `full outer join`,
        initialLeft: worlds[0]!.left,
        initialRight: worlds[0]!.right,
        batches,
        leftPolicy: keyedPolicy,
        rightPolicy: keyedPolicy,
        outputPolicy: outerJoinPolicy,
        build: (left, right) => left.pipe(join(right, `full`)),
        evaluate: fullJoined,
      })
      reach.binary({
        name: `left outer join`,
        initialLeft: worlds[0]!.left,
        initialRight: worlds[0]!.right,
        batches,
        leftPolicy: keyedPolicy,
        rightPolicy: keyedPolicy,
        outputPolicy: outerJoinPolicy,
        build: (left, right) => left.pipe(join(right, `left`)),
        evaluate: leftJoined,
      })
      reach.binary({
        name: `right outer join`,
        initialLeft: worlds[0]!.left,
        initialRight: worlds[0]!.right,
        batches,
        leftPolicy: keyedPolicy,
        rightPolicy: keyedPolicy,
        outputPolicy: outerJoinPolicy,
        build: (left, right) => left.pipe(join(right, `right`)),
        evaluate: rightJoined,
      })
      reach.binary({
        name: `join then grouped reduction`,
        initialLeft: worlds[0]!.left,
        initialRight: worlds[0]!.right,
        batches,
        leftPolicy: keyedPolicy,
        rightPolicy: keyedPolicy,
        outputPolicy: keyedPolicy,
        build: (left, right) =>
          left.pipe(
            innerJoined(right),
            map(([key, [leftValue, rightValue]]) => [
              key,
              leftValue * rightValue,
            ]),
            reduce((values) => {
              if (values.length === 0) return []
              return [
                [
                  values.reduce(
                    (sum, [value, weight]) => sum + value * weight,
                    0,
                  ),
                  1,
                ],
              ]
            }),
          ),
        evaluate: joinedSums,
      })
    },
  )

  registerIncrementalization(
    `checks global ordering and window membership`,
    orderedHistory,
    async (worlds, reach) => {
      await setImmediate()
      reach.unary({
        name: `ordered window`,
        initial: worlds[0]!,
        batches: transitions(worlds),
        inputPolicy: keyedPolicy,
        outputPolicy: keyedPolicy,
        splitDomain: uniqueRowSplitDomain,
        build: (input) =>
          input.pipe(
            orderByWithFractionalIndex((rank) => rank, { limit: 3 }),
            withoutIndex(),
          ),
        evaluate: firstThree,
      })
      reach.unary({
        name: `grouped orderBy`,
        initial: worlds[0]!,
        batches: transitions(worlds),
        inputPolicy: keyedPolicy,
        outputPolicy: keyedPolicy,
        splitDomain: uniqueRowSplitDomain,
        build: (input) =>
          input.pipe(
            groupedOrderByWithFractionalIndex((rank) => rank, {
              groupKeyFn: (key) => key % 2,
              limit: 2,
            }),
            map(([key, [rank]]) => [key, rank] as Keyed),
          ),
        evaluate: firstTwoPerParity,
      })
    },
  )

  oracleProperty({
    id: `ivm.incrementalization-law-cells`,
    law: {
      statement: NAMED_CELLS_LAW,
      authority: `The existing DBSP accumulation/difference law and direct evaluators documented above.`,
      limits: `The named empty, duplicate, replacement, cancellation, presence-flip, falsey-extrema, boundary-tie, zero-width, and promotion cells only.`,
    },
    owns: [
      `src/operators/map.ts#map`,
      `src/operators/filter.ts#filter`,
      `src/operators/consolidate.ts#consolidate`,
      `src/operators/reduce.ts#reduce`,
      `src/operators/groupBy.ts#groupBy`,
      `src/operators/join.ts#join`,
      `src/operators/orderBy.ts#orderByWithFractionalIndex`,
      `src/operators/groupedOrderBy.ts#groupedOrderByWithFractionalIndex`,
    ],
    histories: [{ cells: `named` }],
    label: () =>
      `replays empty, duplicate, replacement, cancellation, and presence-flip cells`,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(NAMED_CELLS_LAW, plan, observe, replayNamedCells),
    check: forwardAssertionJudgment,
  })
})
