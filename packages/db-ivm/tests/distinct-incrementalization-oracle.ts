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

/**
 * Wider bucket histories separate selected identity from the emitted payload.
 * The model's member numbers name fixture-defined unequal selections; variant
 * is unselected data. No representative policy is promised. The full emitted
 * relation must nevertheless contain one unit row per supported selection:
 * a negative row must cancel the actual positive contribution (ARCHITECTURE.md,
 * “Weighted relations and public keys”), not merely an equal selection.
 * Removing duplicates also preserves a source payload: an emitted variant
 * must have appeared in a positive input. This does not choose first/last or
 * require a representative's source slot to remain live.
 */
export type DistinctBucketRow = { member: number; variant: number }
export type DistinctBucketHistory = Array<Array<DistinctBucketRow>>
export const distinctBucketHistory = fc
  .tuple(
    fc.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 }),
    fc.integer({ min: 2, max: 4 }),
    fc.array(
      fc.array(
        fc.record({
          member: fc.integer({ min: 0, max: 4 }),
          variant: fc.integer({ min: 0, max: 3 }),
        }),
        { maxLength: 8 },
      ),
      { maxLength: 12 },
    ),
  )
  .map(([order, copies, tail]): DistinctBucketHistory => {
    const [a, b, c, d] = order as [number, number, number, number]
    const row = (member: number, variant = 0) => ({ member, variant })
    return [
      [],
      [row(a), row(b)],
      [
        ...Array.from({ length: copies }, (_, variant) => row(a, variant)),
        row(b),
      ],
      [row(a, 1), row(b)],
      [row(b)],
      [row(b), row(c)],
      [row(b), row(c), row(d)],
      [row(a), row(b), row(c), row(d)],
      ...tail,
      [],
      [row(a, 2), row(b, 3)],
      [],
    ]
  })

export const DISTINCT_BUCKET_REACH_STATES = [
  `unequal unselected payloads`,
  `three colliding members`,
  `later collision after removal`,
  `empty after unequal payloads`,
] as const

export function distinctBucketReachStates(history: DistinctBucketHistory) {
  const reached = new Set<(typeof DISTINCT_BUCKET_REACH_STATES)[number]>()
  const seen = new Set<number>()
  let removed = false
  let unequal = false
  let before = new Set<number>()
  for (const world of history) {
    const members = new Set(world.map((row) => row.member))
    if (
      [...members].some(
        (member) =>
          new Set(
            world
              .filter((row) => row.member === member)
              .map((row) => row.variant),
          ).size > 1,
      )
    ) {
      reached.add(`unequal unselected payloads`)
      unequal = true
    }
    if ([...members].filter((member) => member < 4).length >= 3)
      reached.add(`three colliding members`)
    if (
      removed &&
      [...members].some((member) => member < 4 && !seen.has(member))
    )
      reached.add(`later collision after removal`)
    if (unequal && world.length === 0)
      reached.add(`empty after unequal payloads`)
    if ([...before].some((member) => !members.has(member))) removed = true
    for (const member of members) seen.add(member)
    before = members
  }
  return reached
}

// Final digests can collide without their nested object hashes colliding.
// Search and verify the entire four-member premise rather than assuming that
// a reported root collision composes. Hashing supplies stimuli, never truth.
export function distinctCollisionFamily(
  digest: (value: unknown) => number,
): Array<unknown> {
  const seen = new Map<number, DistinctValue>()
  for (let value = 0; value < 1_000_000; value++) {
    const next = { id: `family-${value}`, value }
    const key = digest(next)
    const previous = seen.get(key)
    if (previous) {
      const family = [
        [previous, previous],
        [previous, next],
        [next, previous],
        [next, next],
      ]
      const hashes = family.map(digest)
      if (hashes.every((hash) => hash === hashes[0])) {
        for (let n = -1; n > -100; n--) {
          const anchor = [{ id: `anchor`, value: n }]
          if (digest(anchor) !== hashes[0]) return [...family, anchor]
        }
      }
    }
    seen.set(key, next)
  }
  throw new Error(`Distinct four-member collision search exhausted`)
}

// Sum the raw full-row output, preserving negative residues and duplicate
// representatives. The expected selections are recomputed solely from source
// rows. Introduced rows are independent copies of positive source inputs;
// they let this check reject fabricated payloads without selecting a preferred
// representative. Keys must distinguish simultaneous outputs; their numerical
// values and cross-rebuild stability are deliberately unspecified by this law.
export function checkDistinctRepresentatives(
  output: Weighted<[number, DistinctBucketRow]>,
  input: Array<DistinctBucketRow>,
  introduced: Array<DistinctBucketRow>,
  checkpoint: string,
): void {
  const relation = new Map<
    string,
    { key: number; row: DistinctBucketRow; count: number }
  >()
  for (const [[key, row], weight] of output) {
    const id = JSON.stringify([key, row])
    relation.set(id, {
      key,
      row,
      count: (relation.get(id)?.count ?? 0) + weight,
    })
  }
  const rows = [...relation.values()].filter(({ count }) => count !== 0)
  const expected = [...new Set(input.map(({ member }) => member))].sort()
  const observed = rows.map(({ row }) => row.member).sort()
  if (
    rows.some(({ count }) => count !== 1) ||
    rows.some(
      ({ row }) =>
        !introduced.some(
          (source) =>
            source.member === row.member && source.variant === row.variant,
        ),
    ) ||
    new Set(rows.map(({ key }) => key)).size !== rows.length ||
    JSON.stringify(observed) !== JSON.stringify(expected)
  )
    throw new Error(
      `distinct representative contribution diverged at ${checkpoint}: ${JSON.stringify({ expected, rows })}`,
    )
}

declareOracle({
  grammar: [distinctBucketHistory],
  check: [checkDistinctRepresentatives],
})
