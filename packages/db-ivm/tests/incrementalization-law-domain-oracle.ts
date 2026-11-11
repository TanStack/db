// The operator helpers, value domains, history grammar, and direct
// evaluators of the DBSP incrementalization oracle. The law, its production
// drivers, and the comparisons are in
// incrementalization-law-oracle.property.test.ts; the grammar census and the
// checker calibrations are in incrementalization-law-calibration.test.ts.
// This module registers no tests and has no side effects.
import { fc } from '@fast-check/vitest'
import { join, map } from '../src/operators/index.js'
import { StreamBuilder } from '../src/d2.js'
import { DifferenceStreamWriter, LinearUnaryOperator } from '../src/graph.js'
import { MultiSet } from '../src/multiset.js'
import {
  jsonLawValuePolicy,
  weightedStateArbitrary,
  weightedTransitions,
} from './incrementalization-law-oracle.js'
import type { Weighted } from './incrementalization-law-oracle.js'
import type { IStreamBuilder, KeyValue, PipedOperator } from '../src/types.js'

// An inner join matches only present rows, so neither side of its output is
// null.
export function innerJoined<K, V1, V2>(
  right: IStreamBuilder<KeyValue<K, V2>>,
): PipedOperator<KeyValue<K, V1>, KeyValue<K, [V1, V2]>> {
  return join(right, `inner`) as unknown as PipedOperator<
    KeyValue<K, V1>,
    KeyValue<K, [V1, V2]>
  >
}

// The window operators annotate each row with a fractional index. These laws
// compare rows only, so the index is dropped from the output.
export function withoutIndex<K, V>() {
  return map(([key, [value]]: [K, [V, string]]) => [key, value] as [K, V])
}

// A fault for the promotion law: a window that forwards a removal but drops
// the rows entering in the same message, as a top-K that forgets to promote
// the next row would.
export class WithoutPromotionOperator<T> extends LinearUnaryOperator<T, T> {
  inner(collection: MultiSet<T>): MultiSet<T> {
    const changes = collection.getInner()
    return changes.some(([, weight]) => weight < 0)
      ? new MultiSet(changes.filter(([, weight]) => weight < 0))
      : collection
  }
}

export function withoutPromotion<T>(): PipedOperator<T, T> {
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

export type Keyed = [number, number]
export type JoinOutput = [number, [number, number]]
export type OuterJoinOutput = [number, [number | null, number | null]]
export type GroupedMeanOutput = [string, { bucket: number; mean: number }]

export type GroupedTextOutput = [
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
export const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [`x|"y`, ``],
  [`x`, `y|"`],
  [`|"`, ``],
  [``, `|"`],
  [`a`, `"`],
  [`a|"`, ``],
  [``, ``],
]
// Named witnesses reach past the generated -3..3 range, so the table wraps.
export const textPair = (value: number) =>
  TEXT_PAIRS[
    ((value % TEXT_PAIRS.length) + TEXT_PAIRS.length) % TEXT_PAIRS.length
  ]!

export type GroupedOutput = [
  string,
  {
    bucket: number
    total: number
    minimum: number | undefined
    maximum: number | undefined
    mean: number
  },
]

export const CANCELLATION_ROW: Keyed = [99, 99]
export const keyedPolicy = jsonLawValuePolicy<Keyed>()
export const joinPolicy = jsonLawValuePolicy<JoinOutput>()
export const outerJoinPolicy = jsonLawValuePolicy<OuterJoinOutput>()
export const groupedPolicy = jsonLawValuePolicy<GroupedOutput>()
export const groupedTextPolicy = jsonLawValuePolicy<GroupedTextOutput>()
export const groupedMeanPolicy = jsonLawValuePolicy<GroupedMeanOutput>()
export const uniqueRowSplitDomain = {
  uniqueKey: ([key]: Keyed) => String(key),
}

export const weightedWorld = weightedStateArbitrary(
  fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: -3, max: 3 })),
  { maxLength: 8, maxWeight: 2 },
)

export function state(values: Weighted<Keyed>): Map<string, [Keyed, number]> {
  const result = new Map<string, [Keyed, number]>()
  for (const [value, delta] of values) {
    const key = JSON.stringify(value)
    const weight = (result.get(key)?.[1] ?? 0) + delta
    if (weight === 0) result.delete(key)
    else result.set(key, [value, weight])
  }
  return result
}

export function transitions(
  worlds: Array<Weighted<Keyed>>,
): Array<Weighted<Keyed>> {
  return weightedTransitions(worlds, keyedPolicy, CANCELLATION_ROW)
}

export function keyedIdentity(input: Weighted<Keyed>): Weighted<Keyed> {
  return [...state(input).values()].map(([value, weight]) => [value, weight])
}

export function summed(input: Weighted<Keyed>): Weighted<Keyed> {
  const groups = new Map<number, number>()
  for (const [[key, value], weight] of keyedIdentity(input)) {
    groups.set(key, (groups.get(key) ?? 0) + value * weight)
  }
  return [...groups].map(([key, value]) => [[key, value], 1])
}

export function joined(
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

export function fullJoined(
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

export function leftJoined(
  left: Weighted<Keyed>,
  right: Weighted<Keyed>,
): Weighted<OuterJoinOutput> {
  return fullJoined(left, right).filter(
    ([[, [leftValue]]]) => leftValue !== null,
  )
}

export function rightJoined(
  left: Weighted<Keyed>,
  right: Weighted<Keyed>,
): Weighted<OuterJoinOutput> {
  return fullJoined(left, right).filter(
    ([[, [, rightValue]]]) => rightValue !== null,
  )
}

export function joinedSums(
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
export function groupedAggregates(
  input: Weighted<Keyed>,
): Weighted<GroupedOutput> {
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
export function groupedMean(
  input: Weighted<Keyed>,
): Weighted<GroupedMeanOutput> {
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
export function groupedTextExtrema(
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

export const orderedWorld = fc
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
export type OrderedStep =
  | { type: `fresh`; world: Weighted<Keyed> }
  | { type: `remove`; pick: number }
  | { type: `insert`; row: Keyed }
export const orderedHistory: fc.Arbitrary<Array<Weighted<Keyed>>> = fc
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

// The grammar of legal ordered histories. Its calibration test in
// incrementalization-law-calibration.test.ts checks that the generated steps
// reach row promotions, which the ordered laws need.

export function firstThree(input: Weighted<Keyed>): Weighted<Keyed> {
  return keyedIdentity(input)
    .sort(([[leftKey, leftRank]], [[rightKey, rightRank]]) =>
      leftRank === rightRank ? leftKey - rightKey : leftRank - rightRank,
    )
    .slice(0, 3)
}

export function firstTwoPerParity(input: Weighted<Keyed>): Weighted<Keyed> {
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
