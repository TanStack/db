/** Shared comparison laws and their unchanged bounded grammars. Reflexivity,
 * sign symmetry and transitivity follow the query builder's CompareOptions and
 * OrderByOptions contracts. Tagged finite/non-finite values enact the published
 * NaN ordering law; changed bytes enact binary value equality. The native test
 * owner retains the full authority, limits and immediate-return campaigns.
 * Mixed-type order and creation-order object identity are outside this model.
 */
import { expect } from 'vitest'
import { fc } from '@fast-check/vitest'
import { ascComparator, defaultComparator } from '../src/utils/comparison'
import { DEFAULT_COMPARE_OPTIONS } from '../src/utils'
// Input grammar: finite numbers, strings, booleans, valid Dates, and bounded
// arrays of those primitives; same-type pairs/triples isolate order laws.
// Null placement, direction, and string mode are separate option axes. Removing
// any one loses its paired opposite-order witness below. The fixed null,
// locale/lexical, and custom-collation cases reconstruct those boundaries.
// Array length 0/1 and binary length 0/1/128/129 are marginal cases. Plain
// objects are outside this order model because their IDs depend on creation
// order. Mixed-type order is outside this bounded grammar. A tagged grammar
// below admits NaN and invalid Date inputs; an invalid comparator result is
// rejected by the control below.
const arbitraryComparablePrimitive = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
)

const arbitraryDate = fc.date({ noInvalidDate: true })

type NonFiniteFamily = `number` | `date`
type NonFiniteInput = {
  family: NonFiniteFamily
  finiteDays: Array<number>
  unorderedCount: number
  includeNull: boolean
}
type TaggedOrderValue = {
  id: string
  value: number | Date | null
  category: `null` | `finite` | `unordered`
  order: number
}

// The generator's tags are reference facts: finite epoch days have ordinary
// numeric order, null precedes them, and the family's non-finite values follow
// them. Constructing expected signs from these tags avoids asking production
// whether a Date or number is unorderable. Distinct IDs preserve duplicate
// NaNs/invalid Dates in the sorted observation.
function taggedOrderValues(input: NonFiniteInput): Array<TaggedOrderValue> {
  const unordered = () =>
    input.family === `number` ? Number.NaN : new Date(Number.NaN)
  const finite = input.finiteDays.map((day, index) => ({
    id: `finite:${index}`,
    value: input.family === `number` ? day : new Date(day * 86_400_000),
    category: `finite` as const,
    order: day,
  }))
  const rows: Array<TaggedOrderValue> = [
    finite[0]!,
    { id: `unordered:0`, value: unordered(), category: `unordered`, order: 0 },
    ...finite.slice(1),
    ...Array.from({ length: input.unorderedCount - 1 }, (_, index) => ({
      id: `unordered:${index + 1}`,
      value: unordered(),
      category: `unordered` as const,
      order: 0,
    })),
  ]
  if (input.includeNull) {
    rows.splice(2, 0, { id: `null`, value: null, category: `null`, order: 0 })
  }
  return rows
}

function taggedOrderSign(a: TaggedOrderValue, b: TaggedOrderValue): -1 | 0 | 1 {
  const rank = { null: 0, finite: 1, unordered: 2 }
  const difference = rank[a.category] - rank[b.category]
  const valueDifference =
    difference || (a.category === `finite` ? a.order - b.order : 0)
  return valueDifference < 0 ? -1 : valueDifference > 0 ? 1 : 0
}

// Production observes direct comparator returns and the order of a stable
// JavaScript sort using the exported default comparator. The comparison runs
// immediately after each call, so it detects wrong signs and lost or reordered
// duplicate non-finite rows at the exact sort checkpoint.
function assertNonFiniteOrder(
  input: NonFiniteInput,
  compare: (a: number | Date | null, b: number | Date | null) => number = (
    a,
    b,
  ) => ascComparator(a, b, DEFAULT_COMPARE_OPTIONS),
  sortCompare: (
    a: number | Date | null,
    b: number | Date | null,
  ) => number = defaultComparator,
): void {
  const rows = taggedOrderValues(input)
  for (const a of rows) {
    for (const b of rows) {
      const result = compare(a.value, b.value)
      expect(sign(result)).toBe(taggedOrderSign(a, b))
      // Preserve the legacy exact-zero assertion for NaN/NaN, including its
      // distinction between positive and negative zero in Vitest.
      if (a.category === `unordered` && b.category === `unordered`) {
        expect(result).toBe(0)
      }
    }
  }
  const actual = [...rows].sort((a, b) => sortCompare(a.value, b.value))
  const expected = [...rows].sort(taggedOrderSign)
  expect(actual.map((row) => row.id)).toEqual(expected.map((row) => row.id))
}

// Legal inputs contain 1..5 distinct finite numbers or valid epoch-day Dates,
// one or two NaNs/invalid Dates, and optional null. A singleton finite value,
// duplicate non-finite values, negative days, and null presence are margins.
// Removing the family axis misses invalid Dates; removing the duplicate count
// misses equal non-finite rows; removing null misses its default placement.
// Mixed families, Temporal values, symbols, and invalid option objects are not
// generated. The fixed examples below reconstruct the legacy sort histories.
const arbitraryNonFiniteInput: fc.Arbitrary<NonFiniteInput> = fc.record({
  family: fc.constantFrom(`number` as const, `date` as const),
  finiteDays: fc.uniqueArray(fc.integer({ min: -20_000, max: 20_000 }), {
    minLength: 1,
    maxLength: 5,
  }),
  unorderedCount: fc.integer({ min: 1, max: 2 }),
  includeNull: fc.boolean(),
})

const arbitraryComparableArray = fc.array(arbitraryComparablePrimitive, {
  maxLength: 5,
})

function assertValidComparison(result: unknown): asserts result is number {
  expect(
    typeof result === `number` && !Number.isNaN(result),
    `comparator result must be a number other than NaN`,
  ).toBe(true)
}

// Validate before reducing: NaN and non-number results must not appear equal.
const sign = (n: unknown): -1 | 0 | 1 => {
  assertValidComparison(n)
  if (n < 0) return -1
  if (n > 0) return 1
  return 0
}

/**
 * Check antisymmetry property: sign(compare(a, b)) === -sign(compare(b, a))
 * This handles the +0/-0 JavaScript edge case where -0 !== 0 in Object.is
 */
const checkAntisymmetry = (ab: unknown, ba: unknown): boolean => {
  const signAB = sign(ab)
  const signBA = sign(ba)
  // Both zero, or opposite signs
  return (signAB === 0 && signBA === 0) || signAB === -signBA
}

// Same-type arbitraries for comparator tests (cross-type comparison is not guaranteed to be total ordering)
const arbitrarySameTypeString = fc.tuple(fc.string(), fc.string())
const arbitrarySameTypeInt = fc.tuple(fc.integer(), fc.integer())
const arbitrarySameTypeDouble = fc.tuple(
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
)
const arbitrarySameTypeBool = fc.tuple(fc.boolean(), fc.boolean())
const arbitrarySameTypeDate = fc.tuple(
  fc.date({ noInvalidDate: true }),
  fc.date({ noInvalidDate: true }),
)
const arbitrarySameTypeArray = fc.tuple(
  fc.array(fc.integer(), { maxLength: 5 }),
  fc.array(fc.integer(), { maxLength: 5 }),
)

// Pair of same-type comparable values
const arbitrarySameTypePair = fc.oneof(
  arbitrarySameTypeString,
  arbitrarySameTypeInt,
  arbitrarySameTypeDouble,
  arbitrarySameTypeBool,
  arbitrarySameTypeDate,
  arbitrarySameTypeArray,
)

// Triple of same-type values for transitivity
const arbitrarySameTypeTriple = fc.oneof(
  fc.tuple(fc.integer(), fc.integer(), fc.integer()),
  fc.tuple(fc.string(), fc.string(), fc.string()),
  fc.tuple(
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
  ),
)

const arbitraryChangedBytes = fc
  .tuple(
    fc.uint8Array({ minLength: 1, maxLength: 50 }),
    fc.integer({ min: 0, max: 49 }),
    fc.integer({ min: 1, max: 255 }),
  )
  .map(([bytes, indexHint, delta]) => {
    const index = indexHint % bytes.length
    const changed = new Uint8Array(bytes)
    changed[index] = (bytes[index]! + delta) % 256
    return { bytes, changed, index }
  })

function assertChangedBytes(
  {
    bytes,
    changed,
    index,
  }: { bytes: Uint8Array; changed: Uint8Array; index: number },
  equal: (a: Uint8Array, b: Uint8Array) => boolean,
): void {
  expect(index).toBeLessThan(bytes.length)
  expect(changed).toHaveLength(bytes.length)
  expect(changed[index]).not.toBe(bytes[index])
  expect(equal(bytes, new Uint8Array(bytes)), `byte copy must be equal`).toBe(
    true,
  )
  expect(equal(bytes, changed), `changed byte must be unequal`).toBe(false)
  expect(equal(changed, bytes), `changed byte must be unequal`).toBe(false)
}

function assertTransitive(ab: number, bc: number, ac: number): void {
  for (const result of [ab, bc, ac]) assertValidComparison(result)
  if (ab <= 0 && bc <= 0) expect(ac).toBeLessThanOrEqual(0)
}

// This companion holds the shared order and equality checks. The native owner
// retains the direct function-return campaigns and their fixed inputs.
export {
  arbitraryComparablePrimitive,
  arbitraryDate,
  taggedOrderValues,
  taggedOrderSign,
  assertNonFiniteOrder,
  arbitraryNonFiniteInput,
  arbitraryComparableArray,
  assertValidComparison,
  sign,
  checkAntisymmetry,
  arbitrarySameTypeString,
  arbitrarySameTypeInt,
  arbitrarySameTypeDouble,
  arbitrarySameTypeBool,
  arbitrarySameTypeDate,
  arbitrarySameTypeArray,
  arbitrarySameTypePair,
  arbitrarySameTypeTriple,
  arbitraryChangedBytes,
  assertChangedBytes,
  assertTransitive,
}

export type { NonFiniteFamily, NonFiniteInput, TaggedOrderValue }
