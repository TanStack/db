import { setImmediate } from 'node:timers/promises'
import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import {
  consolidate,
  filter,
  fullJoin,
  groupBy,
  groupByOperators,
  groupedOrderByWithFractionalIndex,
  innerJoin,
  leftJoin,
  map,
  negate,
  orderBy,
  reduce,
  rightJoin,
  topK,
} from '../src/operators/index.js'
import {
  assertBinaryIncrementalization,
  assertUnaryIncrementalization,
  jsonLawValuePolicy,
  weightedDifference,
  weightedStateArbitrary,
  weightedTransitions,
} from './incrementalization-law.js'
import type { Weighted } from './incrementalization-law.js'

/**
 * # Does incremental execution equal full recomputation?
 *
 * D2 operators keep state and emit only changes. A wrong delta can leave the
 * final rows looking right after a later batch, so final-state examples are not
 * enough. This suite compares every emitted delta and retained result with a
 * direct recomputation from the complete logical input.
 *
 * The plain evaluators below define the expected relations for reductions,
 * joins, groups, and ordered windows. They use arrays and Maps, not D2
 * operators. The shared checker then delivers each generated logical change as
 * one atomic batch and as legal one-row steps.
 *
 * The generated domain uses small JSON tuples with integer weights. Named
 * cases force empty batches, duplicate weights, replacements, cancellation,
 * presence changes, boundary ties, and a zero-width window. Fault controls
 * prove that the checker rejects missing, sign-flipped, and wrong-member output.
 */

type Keyed = [number, number]
type JoinOutput = [number, [number, number]]
type OuterJoinOutput = [number, [number | null, number | null]]
type GroupedOutput = [string, { bucket: number; total: number }]

const FIXED_SEED = 1741
const replaySeedText = process.env.TANSTACK_DB_IVM_ORACLE_SEED
const replaySeed =
  replaySeedText === undefined ? undefined : Number(replaySeedText)
const RUNS = Number(process.env.TANSTACK_DB_IVM_ORACLE_RUNS ?? 100)
const REPLAY_PATH = process.env.TANSTACK_DB_IVM_ORACLE_PATH
if (
  replaySeedText !== undefined &&
  (replaySeedText.trim() === `` || !Number.isSafeInteger(replaySeed))
) {
  throw new Error(`TANSTACK_DB_IVM_ORACLE_SEED must be an integer`)
}
if (!Number.isSafeInteger(RUNS) || RUNS <= 0) {
  throw new Error(`TANSTACK_DB_IVM_ORACLE_RUNS must be a positive integer`)
}
if (REPLAY_PATH !== undefined && replaySeed === undefined) {
  throw new Error(
    `TANSTACK_DB_IVM_ORACLE_PATH requires TANSTACK_DB_IVM_ORACLE_SEED`,
  )
}

const generatedCampaigns =
  replaySeed === undefined
    ? [
        { name: `fixed`, seed: FIXED_SEED, path: undefined },
        { name: `random`, seed: undefined, path: undefined },
      ]
    : [{ name: `replay`, seed: replaySeed, path: REPLAY_PATH }]

function campaignParameters(campaign: (typeof generatedCampaigns)[number]) {
  return {
    numRuns: RUNS,
    ...(campaign.seed === undefined ? {} : { seed: campaign.seed }),
    ...(campaign.path === undefined ? {} : { path: campaign.path }),
  }
}

const CANCELLATION_ROW: Keyed = [99, 99]
const keyedPolicy = jsonLawValuePolicy<Keyed>()
const joinPolicy = jsonLawValuePolicy<JoinOutput>()
const outerJoinPolicy = jsonLawValuePolicy<OuterJoinOutput>()
const groupedPolicy = jsonLawValuePolicy<GroupedOutput>()
const uniqueRowSplitDomain = {
  uniqueKey: ([key]: Keyed) => String(key),
}

/**
 * The model observes relation membership and multiplicity. Plain `orderBy`
 * exposes selected members, not their sequence indices. Publication timing and
 * SQL meaning are separate contracts.
 *
 * Normal runs pair a stable campaign with a new random seed. Replay variables
 * instead select only the recorded seed and shrink path.
 */

const weightedWorld = weightedStateArbitrary(
  fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: -3, max: 3 })),
  { maxLength: 8, maxWeight: 2 },
)

function state(values: Weighted<Keyed>): Map<string, [Keyed, number]> {
  const result = new Map<string, [Keyed, number]>()
  for (const [value, delta] of values) {
    const key = JSON.stringify(value)
    const weight = (result.get(key)?.[1] ?? 0) + delta
    if (weight === 0) result.delete(key)
    else result.set(key, [value, weight])
  }
  return result
}

function transitions(worlds: Array<Weighted<Keyed>>): Array<Weighted<Keyed>> {
  return weightedTransitions(worlds, keyedPolicy, CANCELLATION_ROW)
}

function keyedIdentity(input: Weighted<Keyed>): Weighted<Keyed> {
  return [...state(input).values()].map(([value, weight]) => [value, weight])
}

function summed(input: Weighted<Keyed>): Weighted<Keyed> {
  const groups = new Map<number, number>()
  for (const [[key, value], weight] of keyedIdentity(input)) {
    groups.set(key, (groups.get(key) ?? 0) + value * weight)
  }
  return [...groups].map(([key, value]) => [[key, value], 1])
}

function joined(
  left: Weighted<Keyed>,
  right: Weighted<Keyed>,
): Weighted<JoinOutput> {
  const result: Weighted<JoinOutput> = []
  for (const [[leftKey, leftValue], leftWeight] of keyedIdentity(left)) {
    for (const [[rightKey, rightValue], rightWeight] of keyedIdentity(right)) {
      if (leftKey === rightKey) {
        result.push([
          [leftKey, [leftValue, rightValue]],
          leftWeight * rightWeight,
        ])
      }
    }
  }
  return result
}

function fullJoined(
  left: Weighted<Keyed>,
  right: Weighted<Keyed>,
): Weighted<OuterJoinOutput> {
  const leftRows = keyedIdentity(left)
  const rightRows = keyedIdentity(right)
  const result: Weighted<OuterJoinOutput> = []
  for (const [[leftKey, leftValue], leftWeight] of leftRows) {
    const matches = rightRows.filter(([[rightKey]]) => rightKey === leftKey)
    if (matches.length === 0) {
      result.push([[leftKey, [leftValue, null]], leftWeight])
    } else {
      for (const [[, rightValue], rightWeight] of matches) {
        result.push([
          [leftKey, [leftValue, rightValue]],
          leftWeight * rightWeight,
        ])
      }
    }
  }
  for (const [[rightKey, rightValue], rightWeight] of rightRows) {
    if (leftRows.every(([[leftKey]]) => leftKey !== rightKey)) {
      result.push([[rightKey, [null, rightValue]], rightWeight])
    }
  }
  return result
}

function leftJoined(
  left: Weighted<Keyed>,
  right: Weighted<Keyed>,
): Weighted<OuterJoinOutput> {
  return fullJoined(left, right).filter(
    ([[, [leftValue]]]) => leftValue !== null,
  )
}

function rightJoined(
  left: Weighted<Keyed>,
  right: Weighted<Keyed>,
): Weighted<OuterJoinOutput> {
  return fullJoined(left, right).filter(
    ([[, [, rightValue]]]) => rightValue !== null,
  )
}

function joinedSums(
  left: Weighted<Keyed>,
  right: Weighted<Keyed>,
): Weighted<Keyed> {
  const sums = new Map<number, number>()
  for (const [[key, [leftValue, rightValue]], weight] of joined(left, right)) {
    sums.set(key, (sums.get(key) ?? 0) + leftValue * rightValue * weight)
  }
  return [...sums].map(([key, value]) => [[key, value], 1])
}

function groupedSums(input: Weighted<Keyed>): Weighted<GroupedOutput> {
  const groups = new Map<number, number>()
  for (const [[key, value], weight] of keyedIdentity(input)) {
    const bucket = key % 2
    groups.set(bucket, (groups.get(bucket) ?? 0) + value * weight)
  }
  return [...groups].map(([bucket, total]) => [
    [JSON.stringify({ bucket }), { bucket, total }],
    1,
  ])
}

function topTwo(input: Weighted<Keyed>): Weighted<Keyed> {
  const groups = new Map<number, Array<[number, number]>>()
  for (const [[key, value], weight] of keyedIdentity(input)) {
    const values = groups.get(key) ?? []
    values.push([value, weight])
    groups.set(key, values)
  }
  return [...groups].flatMap(([key, values]) =>
    values
      .sort(([left], [right]) => left - right)
      .slice(0, 2)
      .map(([value, weight]) => [[key, value] as Keyed, weight] as const),
  )
}

const orderedWorld = fc
  .uniqueArray(
    fc.tuple(fc.integer({ min: 0, max: 7 }), fc.integer({ min: -20, max: 20 })),
    { maxLength: 8, selector: ([key]) => key },
  )
  .filter((rows) => new Set(rows.map(([, rank]) => rank)).size === rows.length)
  .map((rows): Weighted<Keyed> => rows.map((row) => [row, 1]))

function firstThree(input: Weighted<Keyed>): Weighted<Keyed> {
  return keyedIdentity(input)
    .sort(([[leftKey, leftRank]], [[rightKey, rightRank]]) =>
      leftRank === rightRank ? leftKey - rightKey : leftRank - rightRank,
    )
    .slice(0, 3)
}

function firstTwoPerParity(input: Weighted<Keyed>): Weighted<Keyed> {
  const groups = new Map<number, Array<[Keyed, number]>>()
  for (const [value, weight] of keyedIdentity(input)) {
    const values = groups.get(value[0] % 2) ?? []
    values.push([value, weight])
    groups.set(value[0] % 2, values)
  }
  return [...groups.values()].flatMap((values) =>
    values
      .sort(([[leftKey, leftRank]], [[rightKey, rightRank]]) =>
        leftRank === rightRank ? leftKey - rightKey : leftRank - rightRank,
      )
      .slice(0, 2),
  )
}

describe(`DBSP incrementalization laws`, () => {
  it.each(generatedCampaigns)(
    `checks consolidate, reduce, and grouped top-K against full recomputation ($name campaign)`,
    async (campaign) => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(weightedWorld, { minLength: 2, maxLength: 7 }),
          async (worlds) => {
            // Yield between complete histories so stress runs can report progress.
            // Graph delivery and every observation within a history stay synchronous.
            await setImmediate()
            const batches = transitions(worlds)
            assertUnaryIncrementalization({
              name: `consolidate`,
              initial: worlds[0]!,
              batches,
              inputPolicy: keyedPolicy,
              outputPolicy: keyedPolicy,
              build: (input) => input.pipe(consolidate()),
              evaluate: keyedIdentity,
            })
            assertUnaryIncrementalization({
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
            assertUnaryIncrementalization({
              name: `groupBy reduction`,
              initial: worlds[0]!,
              batches,
              inputPolicy: keyedPolicy,
              outputPolicy: groupedPolicy,
              build: (input) =>
                input.pipe(
                  groupBy(([key]) => ({ bucket: key % 2 }), {
                    total: groupByOperators.sum(([, value]) => value),
                  }),
                ),
              evaluate: groupedSums,
            })
            assertUnaryIncrementalization({
              name: `top-K`,
              initial: worlds[0]!,
              batches,
              inputPolicy: keyedPolicy,
              outputPolicy: keyedPolicy,
              build: (input) =>
                input.pipe(topK((left, right) => left - right, { limit: 2 })),
              evaluate: topTwo,
            })
          },
        ),
        campaignParameters(campaign),
      )
    },
  )

  it.each(generatedCampaigns)(
    `checks simultaneous binary join deltas and split delivery ($name campaign)`,
    async (campaign) => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.tuple(weightedWorld, weightedWorld), {
            minLength: 2,
            maxLength: 7,
          }),
          async (generated) => {
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
            assertBinaryIncrementalization({
              name: `inner join`,
              initialLeft: worlds[0]!.left,
              initialRight: worlds[0]!.right,
              batches,
              leftPolicy: keyedPolicy,
              rightPolicy: keyedPolicy,
              outputPolicy: joinPolicy,
              build: (left, right) => left.pipe(innerJoin(right)),
              evaluate: joined,
            })
            assertBinaryIncrementalization({
              name: `full outer join`,
              initialLeft: worlds[0]!.left,
              initialRight: worlds[0]!.right,
              batches,
              leftPolicy: keyedPolicy,
              rightPolicy: keyedPolicy,
              outputPolicy: outerJoinPolicy,
              build: (left, right) => left.pipe(fullJoin(right)),
              evaluate: fullJoined,
            })
            assertBinaryIncrementalization({
              name: `left outer join`,
              initialLeft: worlds[0]!.left,
              initialRight: worlds[0]!.right,
              batches,
              leftPolicy: keyedPolicy,
              rightPolicy: keyedPolicy,
              outputPolicy: outerJoinPolicy,
              build: (left, right) => left.pipe(leftJoin(right)),
              evaluate: leftJoined,
            })
            assertBinaryIncrementalization({
              name: `right outer join`,
              initialLeft: worlds[0]!.left,
              initialRight: worlds[0]!.right,
              batches,
              leftPolicy: keyedPolicy,
              rightPolicy: keyedPolicy,
              outputPolicy: outerJoinPolicy,
              build: (left, right) => left.pipe(rightJoin(right)),
              evaluate: rightJoined,
            })
            assertBinaryIncrementalization({
              name: `join then grouped reduction`,
              initialLeft: worlds[0]!.left,
              initialRight: worlds[0]!.right,
              batches,
              leftPolicy: keyedPolicy,
              rightPolicy: keyedPolicy,
              outputPolicy: keyedPolicy,
              build: (left, right) =>
                left.pipe(
                  innerJoin(right),
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
        ),
        campaignParameters(campaign),
      )
    },
  )

  it.each(generatedCampaigns)(
    `checks global ordering and window membership ($name campaign)`,
    async (campaign) => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderedWorld, { minLength: 2, maxLength: 7 }),
          async (worlds) => {
            await setImmediate()
            assertUnaryIncrementalization({
              name: `orderBy`,
              initial: worlds[0]!,
              batches: transitions(worlds),
              inputPolicy: keyedPolicy,
              outputPolicy: keyedPolicy,
              splitDomain: uniqueRowSplitDomain,
              build: (input) =>
                input.pipe(orderBy((rank) => rank, { limit: 3 })),
              evaluate: firstThree,
            })
            assertUnaryIncrementalization({
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
        ),
        campaignParameters(campaign),
      )
    },
  )

  it(`replays empty, duplicate, replacement, cancellation, and presence-flip cells`, () => {
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
      build: (left, right) => left.pipe(fullJoin(right)),
      evaluate: fullJoined,
    })
    expect(binaryReach).toEqual({
      atomicCheckpoints: 3,
      atomicDeliveries: 3,
      splitCheckpoints: 3,
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
      build: (input) => input.pipe(orderBy((rank) => rank, { limit: 0 })),
      evaluate: () => [],
    })
  })

  it(`rejects omitted, sign-flipped, wrong-member, and wrong-window output`, () => {
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
        build: (input) => input.pipe(negate()),
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
            orderBy((rank) => rank, {
              comparator: (left, right) => right - left,
              limit: 3,
            }),
          ),
        evaluate: firstThree,
      }),
    ).toThrow(/output delta diverged/)
  })
})
