/**
 * Distinct preserves one occurrence of every positively supported selected
 * value, even when unequal values have the same digest. Authority: the unique
 * combinations promised by docs/guides/live-queries.md, “Distinct”, and the
 * DBSP accumulation law used by incrementalization-law-oracle.ts.
 *
 * This extends that owner's value/history domain. The model recomputes from
 * plain records; hashing only discovers adversarial inputs for the driver.
 * The bounded domain is immutable {id: string, value: integer} records. It
 * exercises two unequal collision members and one noncolliding anchor. It
 * does not specify representative choice for unequal unselected fields,
 * ordering, readiness, or intermediate source-transaction publications.
 */
import { fc } from '@fast-check/vitest'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import type { Weighted } from './incrementalization-law-oracle.js'

export type DistinctValue = { id: string; value: number }
export type DistinctWorld = Array<number>
export type DistinctHistory = Array<DistinctWorld>

export const DISTINCT_REACH_STATES = [
  `colliding values`,
  `duplicate support`,
  `partial removal`,
  `last removal`,
  `reinsertion`,
] as const

// Count input conditions after the driver checked their checkpoints. The two
// collision members are labels 0 and 1; label 2 is an unequal anchor. No
// production state supplies these premises.
export function distinctReachStates(history: DistinctHistory) {
  const reached = new Set<(typeof DISTINCT_REACH_STATES)[number]>()
  const seen = new Set<number>()
  let previous = [0, 0]
  for (const world of history) {
    const counts = [0, 1].map(
      (label) => world.filter((x) => x === label).length,
    )
    if (counts.every((count) => count > 0)) reached.add(`colliding values`)
    for (const label of [0, 1]) {
      const count = counts[label]!
      const before = previous[label]!
      if (count > 1) reached.add(`duplicate support`)
      if (before > count && count > 0) reached.add(`partial removal`)
      if (before > 0 && count === 0 && counts[1 - label]! > 0)
        reached.add(`last removal`)
      if (before === 0 && count > 0 && seen.has(label))
        reached.add(`reinsertion`)
      if (count > 0) seen.add(label)
    }
    previous = counts
  }
  return reached
}

// Class numbers are model-only labels for fixture-defined unequal values.
// World slots become unique source keys in the Collection receiving driver.
// Repeated labels represent equal selections with independent source support.
export const distinctHistory = fc
  .tuple(
    fc.boolean(),
    fc.boolean(),
    fc.integer({ min: 2, max: 4 }),
    fc.array(fc.array(fc.integer({ min: 0, max: 2 }), { maxLength: 8 }), {
      maxLength: 12,
    }),
  )
  .map(([reverse, together, copies, tail]): DistinctHistory => {
    const a = reverse ? 1 : 0
    const b = reverse ? 0 : 1
    return [
      [],
      ...(together ? [] : [[a]]),
      [a, b, 2],
      [...Array<number>(copies).fill(a), b, 2],
      [a, b, 2],
      [b, 2],
      [a, b, 2],
      [b, a, 2],
      ...tail,
      [],
      [a, b, 2],
      [],
    ]
  })

// Birthday-search actual digests, with no hash replacement. The original
// report's pair is tried first, then up to 500,000 records. Failure to find a
// collision or a digest-distinct anchor is a setup error, never evidence that
// production passed the law.
export function distinctCollisionValues(
  digest: (value: DistinctValue) => number,
): Array<DistinctValue> {
  const make = (value: number) => ({ id: `item-${value}`, value })
  const withAnchor = (left: DistinctValue, right: DistinctValue) => {
    const collisionHash = digest(left)
    for (let value = -1; value >= -500_000; value--) {
      const anchor = make(value)
      if (digest(anchor) !== collisionHash) return [left, right, anchor]
    }
    throw new Error(`Distinct noncolliding anchor search exhausted`)
  }
  const reported = [make(51277), make(90754)]
  if (digest(reported[0]!) === digest(reported[1]!))
    return withAnchor(reported[0]!, reported[1]!)
  const seen = new Map<number, number>()
  for (let value = 0; value < 500_000; value++) {
    const hash = digest(make(value))
    const previous = seen.get(hash)
    if (previous !== undefined) return withAnchor(make(previous), make(value))
    seen.set(hash, value)
  }
  throw new Error(`Distinct collision fixture search exhausted`)
}

// Equality in this domain is equality of both named fields. Neither the
// reference nor its comparison imports production hashing/equality semantics.
export function distinctValueIdentity(value: DistinctValue): string {
  return JSON.stringify([value.id, value.value])
}

export function recomputeDistinct(
  input: Weighted<DistinctValue>,
): Weighted<DistinctValue> {
  const counts = new Map<string, { value: DistinctValue; count: number }>()
  for (const [value, weight] of input) {
    const identity = distinctValueIdentity(value)
    const count = (counts.get(identity)?.count ?? 0) + weight
    counts.set(identity, { value, count })
  }
  return [...counts.values()]
    .filter(({ count }) => count > 0)
    .map(({ value }) => [{ ...value }, 1])
}

// Preserve duplicate actual rows. Converting actual output to a Set would
// silently accept duplicate output, just as checking size alone loses values.
export function checkDistinctSnapshot(
  actual: Array<DistinctValue>,
  input: Weighted<DistinctValue>,
  checkpoint: number,
): void {
  const expected = recomputeDistinct(input).map(([value]) =>
    distinctValueIdentity(value),
  )
  const observed = actual.map(distinctValueIdentity)
  if (JSON.stringify(observed.sort()) !== JSON.stringify(expected.sort()))
    throw new Error(
      `distinct snapshot diverged at checkpoint ${checkpoint}: ` +
        `expected ${JSON.stringify(expected)}, actual ${JSON.stringify(observed)}`,
    )
}

declareOracle({
  model: [recomputeDistinct],
  grammar: [distinctHistory],
  check: [checkDistinctSnapshot],
})
