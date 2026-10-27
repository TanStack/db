import { setImmediate } from 'node:timers/promises'
import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import {
  consolidate,
  filter,
  groupBy,
  groupByOperators,
  groupedOrderByWithFractionalIndex,
  join,
  map,
  orderByWithFractionalIndex,
  reduce,
} from '../src/operators/index.js'
import { StreamBuilder } from '../src/d2.js'
import { DifferenceStreamWriter, LinearUnaryOperator } from '../src/graph.js'
import { MultiSet } from '../src/multiset.js'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config.js'
import {
  assertBinaryIncrementalization,
  assertUnaryIncrementalization,
  jsonLawValuePolicy,
  weightedDifference,
  weightedStateArbitrary,
  weightedTransitions,
} from './incrementalization-law-oracle.js'
import type {
  IncrementalizationReach,
  Weighted,
} from './incrementalization-law-oracle.js'
import type { IStreamBuilder, KeyValue, PipedOperator } from '../src/types.js'

// An inner join matches only present rows, so neither side of its output is
// null.
function innerJoined<K, V1, V2>(
  right: IStreamBuilder<KeyValue<K, V2>>,
): PipedOperator<KeyValue<K, V1>, KeyValue<K, [V1, V2]>> {
  return join(right, `inner`) as unknown as PipedOperator<
    KeyValue<K, V1>,
    KeyValue<K, [V1, V2]>
  >
}

// The window operators annotate each row with a fractional index. These laws
// compare rows only, so the index is dropped from the output.
function withoutIndex<K, V>() {
  return map(([key, [value]]: [K, [V, string]]) => [key, value] as [K, V])
}

// A fault for the promotion law: a window that forwards a removal but drops
// the rows entering in the same message, as a top-K that forgets to promote
// the next row would.
class WithoutPromotionOperator<T> extends LinearUnaryOperator<T, T> {
  inner(collection: MultiSet<T>): MultiSet<T> {
    const changes = collection.getInner()
    return changes.some(([, weight]) => weight < 0)
      ? new MultiSet(changes.filter(([, weight]) => weight < 0))
      : collection
  }
}

function withoutPromotion<T>(): PipedOperator<T, T> {
  return (stream: IStreamBuilder<T>): IStreamBuilder<T> => {
    const output = new StreamBuilder<T>(
      stream.graph,
      new DifferenceStreamWriter<T>(),
    )
    stream.graph.addOperator(
      new WithoutPromotionOperator<T>(
        stream.graph.getNextOperatorId(),
        stream.connectReader(),
        output.writer,
      ),
    )
    return output
  }
}

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

type Keyed = [number, number]
type JoinOutput = [number, [number, number]]
type OuterJoinOutput = [number, [number | null, number | null]]
type GroupedMeanOutput = [string, { bucket: number; mean: number }]

type GroupedTextOutput = [
  string,
  {
    bucket: number
    lowFirst: string | undefined
    highFirst: string | undefined
    lowSecond: string | undefined
    highSecond: string | undefined
  },
]

/**
 * Each value names a pair of strings. groupBy merges contributions with equal
 * pre-aggregate values without hashing them, so its identity for a string
 * must not depend on where one value ends and the next begins. A string's
 * identity is `"` and its text, joined to the next part with `|`, so the
 * pairs `["x|\"y", ""]` and `["x", "y|\""]`, and `["|\"", ""]` and
 * `["", "|\""]`, read the same without each string's length.
 */
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [`x|"y`, ``],
  [`x`, `y|"`],
  [`|"`, ``],
  [``, `|"`],
  [`a`, `"`],
  [`a|"`, ``],
  [``, ``],
]
// Named witnesses reach past the generated -3..3 range, so the table wraps.
const textPair = (value: number) =>
  TEXT_PAIRS[
    ((value % TEXT_PAIRS.length) + TEXT_PAIRS.length) % TEXT_PAIRS.length
  ]!

type GroupedOutput = [
  string,
  {
    bucket: number
    total: number
    minimum: number | undefined
    maximum: number | undefined
    mean: number
  },
]

const FIXED_SEED = 1741
const LAW_PROPERTY = `ivm.incrementalization-law`
const RUNS = oracleRuns(100)

// The fixed campaign stands aside during a path replay. The random campaign is
// a fresh seed, or the recorded seed and path of this property when replayed.
const generatedCampaigns = [
  {
    name: `fixed`,
    test: oracleReplayTest(it),
    parameters: { numRuns: RUNS, seed: FIXED_SEED },
  },
  {
    name: `random`,
    test: oracleReplayTest(it, LAW_PROPERTY),
    parameters: oraclePropertyOptions(100, LAW_PROPERTY),
  },
]

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
  private atomicCheckpoints = 0
  private atomicDeliveries = 0
  private splitCheckpoints = 0
  private splitDeliveries = 0
  private unsplitDeliveries = 0

  unary: typeof assertUnaryIncrementalization = (law) =>
    this.add(assertUnaryIncrementalization(law), 1)

  binary: typeof assertBinaryIncrementalization = (law) =>
    this.add(assertBinaryIncrementalization(law), 2)

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

const CANCELLATION_ROW: Keyed = [99, 99]
const keyedPolicy = jsonLawValuePolicy<Keyed>()
const joinPolicy = jsonLawValuePolicy<JoinOutput>()
const outerJoinPolicy = jsonLawValuePolicy<OuterJoinOutput>()
const groupedPolicy = jsonLawValuePolicy<GroupedOutput>()
const groupedTextPolicy = jsonLawValuePolicy<GroupedTextOutput>()
const groupedMeanPolicy = jsonLawValuePolicy<GroupedMeanOutput>()
const uniqueRowSplitDomain = {
  uniqueKey: ([key]: Keyed) => String(key),
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

/**
 * Group extrema come from every retained defined value. Zero is a value, not
 * absence. The model recomputes from plain weighted rows and shares no
 * aggregate reducer with production.
 */
function groupedAggregates(input: Weighted<Keyed>): Weighted<GroupedOutput> {
  const groups = new Map<
    number,
    { total: number; minimum: number; maximum: number; count: number }
  >()
  for (const [[key, value], weight] of keyedIdentity(input)) {
    const bucket = key % 2
    const current = groups.get(bucket)
    groups.set(
      bucket,
      current === undefined
        ? {
            total: value * weight,
            minimum: value,
            maximum: value,
            count: weight,
          }
        : {
            total: current.total + value * weight,
            minimum: Math.min(current.minimum, value),
            maximum: Math.max(current.maximum, value),
            count: current.count + weight,
          },
    )
  }
  return [...groups].map(([bucket, { count, ...aggregates }]) => [
    [
      JSON.stringify({ bucket }),
      // The mean is the weighted total over the weighted row count.
      { bucket, ...aggregates, mean: aggregates.total / count },
    ],
    1,
  ])
}

/**
 * The per-bucket mean alone. With no other aggregate, every value's identity
 * comes from avg, so an avg identity that merges different sums shows here.
 */
function groupedMean(input: Weighted<Keyed>): Weighted<GroupedMeanOutput> {
  const groups = new Map<number, { total: number; count: number }>()
  for (const [[key, value], weight] of keyedIdentity(input)) {
    const current = groups.get(key % 2) ?? { total: 0, count: 0 }
    groups.set(key % 2, {
      total: current.total + value * weight,
      count: current.count + weight,
    })
  }
  return [...groups].map(([bucket, { total, count }]) => [
    [JSON.stringify({ bucket }), { bucket, mean: total / count }],
    1,
  ])
}

/** Per-bucket string extrema of both parts, recomputed from plain rows. */
function groupedTextExtrema(
  input: Weighted<Keyed>,
): Weighted<GroupedTextOutput> {
  const groups = new Map<number, Array<readonly [string, string]>>()
  for (const [[key, value]] of keyedIdentity(input)) {
    const pairs = groups.get(key % 2) ?? []
    pairs.push(textPair(value))
    groups.set(key % 2, pairs)
  }
  const low = (values: Array<string>) =>
    values.reduce((left, right) => (right < left ? right : left))
  const high = (values: Array<string>) =>
    values.reduce((left, right) => (right > left ? right : left))
  return [...groups].map(([bucket, pairs]) => {
    const first = pairs.map(([text]) => text)
    const second = pairs.map(([, text]) => text)
    return [
      [
        JSON.stringify({ bucket }),
        {
          bucket,
          lowFirst: low(first),
          highFirst: high(first),
          lowSecond: low(second),
          highSecond: high(second),
        },
      ],
      1,
    ]
  })
}

const orderedWorld = fc
  .uniqueArray(
    fc.tuple(fc.integer({ min: 0, max: 7 }), fc.integer({ min: -20, max: 20 })),
    { maxLength: 8, selector: ([key]) => key },
  )
  .filter((rows) => new Set(rows.map(([, rank]) => rank)).size === rows.length)
  .map((rows): Weighted<Keyed> => rows.map((row) => [row, 1]))

// Independent worlds rarely share rows, so a window row seldom leaves while
// the next row stays to be promoted. Most ordered steps therefore edit the
// previous world: they remove one row or insert one with an unused key and
// rank. A fresh world still replaces the relation now and then.
type OrderedStep =
  | { type: `fresh`; world: Weighted<Keyed> }
  | { type: `remove`; pick: number }
  | { type: `insert`; row: Keyed }
const orderedHistory: fc.Arbitrary<Array<Weighted<Keyed>>> = fc
  .tuple(
    orderedWorld,
    fc.array(
      fc.oneof(
        {
          weight: 1,
          arbitrary: orderedWorld.map((world) => ({
            type: `fresh` as const,
            world,
          })),
        },
        {
          weight: 2,
          arbitrary: fc.nat(7).map((pick) => ({
            type: `remove` as const,
            pick,
          })),
        },
        {
          weight: 2,
          arbitrary: fc
            .tuple(
              fc.integer({ min: 0, max: 7 }),
              fc.integer({ min: -20, max: 20 }),
            )
            .map((row) => ({ type: `insert` as const, row })),
        },
      ),
      { minLength: 1, maxLength: 6 },
    ),
  )
  .map(([initial, steps]) => {
    const worlds = [initial]
    for (const step of steps as Array<OrderedStep>) {
      const previous = worlds.at(-1)!
      if (step.type === `fresh`) {
        worlds.push(step.world)
      } else if (step.type === `remove`) {
        worlds.push(
          previous.filter(
            (_, index) => index !== step.pick % Math.max(previous.length, 1),
          ),
        )
      } else {
        const [key, rank] = step.row
        const unused = previous.every(
          ([[otherKey, otherRank]]) => otherKey !== key && otherRank !== rank,
        )
        worlds.push(unused ? [...previous, [step.row, 1]] : previous)
      }
    }
    return worlds
  })

// The grammar of legal ordered histories. Its calibration test checks that the
// generated steps reach row promotions, which the ordered laws need.
declareOracle({ grammar: [orderedHistory] })

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
  for (const campaign of generatedCampaigns)
    campaign.test(
      `checks consolidate, reduce, and groupBy against full recomputation (${campaign.name} campaign)`,
      async () => {
        const reach = new CampaignReach()
        await fc.assert(
          fc.asyncProperty(
            fc.array(weightedWorld, { minLength: 2, maxLength: 7 }),
            async (worlds) => {
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
                      lowFirst: groupByOperators.min(
                        ([, value]) => textPair(value)[0],
                      ),
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
          ),
          campaign.parameters,
        )
        reach.expectBothDeliveries()
      },
    )

  for (const campaign of generatedCampaigns)
    campaign.test(
      `checks simultaneous binary join deltas and split delivery (${campaign.name} campaign)`,
      async () => {
        const reach = new CampaignReach()
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
          ),
          campaign.parameters,
        )
        reach.expectBothDeliveries()
      },
    )

  for (const campaign of generatedCampaigns)
    campaign.test(
      `checks global ordering and window membership (${campaign.name} campaign)`,
      async () => {
        const reach = new CampaignReach()
        await fc.assert(
          fc.asyncProperty(orderedHistory, async (worlds) => {
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
          }),
          campaign.parameters,
        )
        reach.expectBothDeliveries()
      },
    )

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
    for (const [worlds] of fc.sample(fc.tuple(orderedHistory), {
      seed: FIXED_SEED,
      numRuns: RUNS,
    })) {
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
  })

  it(`rejects invalid negative and duplicate-key input states`, () => {
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
