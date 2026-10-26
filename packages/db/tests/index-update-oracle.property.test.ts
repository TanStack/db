import { describe, expect, test, vi } from 'vitest'
import { fc } from '@fast-check/vitest'
import { Temporal } from 'temporal-polyfill'
import { createCollection } from '../src/collection/index.js'
import { CollectionInErrorStateError } from '../src/errors.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { eq } from '../src/query/builder/functions.js'
import { PropRef } from '../src/query/ir.js'
import { mockSyncCollectionOptions } from './utils'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleRuns,
} from './oracle-config'
import { indexTypes, withCollectionCleanup } from './index-update-support'
import type { BaseIndex } from '../src/indexes/base-index.js'

/**
 * An index is a derived multimap from indexed value to source keys.
 *
 * Authority: docs/reference/interfaces/IndexInterface.md and the Collection
 * ordered-read/createIndex contract in docs/reference/interfaces/Collection.md.
 * This owner checks BasicIndex and BTreeIndex on bounded scalar histories and selected
 * comparator groups. It does not establish comparator transitivity, all
 * JavaScript values, arbitrary collation locales, or long Collection histories.
 *
 * A native Map is the sole ownership model. After put, delete, or full build,
 * the oracle groups that Map by value and freshly sorts the groups. BasicIndex
 * and BTreeIndex must agree on key count, key membership, equality/range lookup,
 * full ordered reads, and rebuild behavior. Small duplicate values and signed zero
 * force collisions in the value groups without copying either index structure.
 * The comparison runs after every direct index action, after fresh build, and
 * after each named Collection read. Collection rows and their order are public;
 * direct index observations are the documented IndexInterface boundary.
 * The Map retains each key's value because a later same-key put or delete can
 * distinguish states with the same value multiplicities but different owners.
 * An absent lower range bound includes the minimum even when its unused
 * `fromInclusive` flag is false. With an explicit exclusive lower bound,
 * the value at that bound is excluded.
 * Exact equality membership also stays distinct from comparator position:
 * replacing a value with one in a different exact-equality bucket at the
 * same comparator position must move its exact lookup membership. This law
 * concerns returned index results, not bucket identity or maintenance work.
 * A build is one of those direct actions even when a source value is
 * `undefined`: default nulls-first order must hold after build just as it
 * does after incremental add. The nullish lane below exercises both paths.
 * A separate mixed number/string lane checks key conservation only. A full
 * ordered read and an indexed public snapshot must contain each live source
 * key once, even when unlike values have no declared relative sort order.
 * A separate two-value callback lane checks legacy scalar input kinds for
 * immutable Date, Temporal.Instant, and byte values across both index types.
 */

type IndexValue = number

type IndexAction =
  | { type: `put`; key: string; value: IndexValue }
  | { type: `delete`; key: string }
  | { type: `build`; entries: Array<[string, IndexValue]> }

const arbitraryValue: fc.Arbitrary<IndexValue> = fc.oneof(
  fc.integer({ min: -3, max: 3 }),
  fc.constant(-0),
)

const arbitraryAction: fc.Arbitrary<IndexAction> = fc.oneof(
  fc.record({
    type: fc.constant(`put` as const),
    key: fc.integer({ min: 0, max: 7 }).map(String),
    value: arbitraryValue,
  }),
  fc.record({
    type: fc.constant(`delete` as const),
    key: fc.integer({ min: 0, max: 7 }).map(String),
  }),
  fc.record({
    type: fc.constant(`build` as const),
    entries: fc.array(
      fc.tuple(fc.integer({ min: 0, max: 7 }).map(String), arbitraryValue),
      { maxLength: 8 },
    ),
  }),
)

/**
 * History grammar: 1..100 source actions after a fixed replacement/continuation
 * prefix; keys 0..7, values -3..3 plus -0, and builds of 0..8 entries. Put
 * maps to index add/update depending on Map ownership; delete of an absent
 * source key is a source no-op. Build replaces the whole source Map. These are
 * model actions, not names for additional production index methods.
 *
 * Reconstruction: the fixed prefix reaches nonempty replacement, update,
 * delete, empty replacement, and continuation; the pinned tail reaches a new
 * key after replacement. Generated put supplies duplicate values and same-key
 * updates, delete supplies retirement, and build supplies arbitrary replacement
 * sets. Removing any one action loses that transition. Removing the narrow
 * key/value overlap loses collisions; removing -0 loses signed-zero equality.
 * Range probes straddle -2, 0, and 2, including their exact boundaries and
 * upper-only reads with an unused exclusive-lower flag and paired reads with
 * an explicit exclusive lower bound. Both run after every action, including
 * changes to the minimum and an empty build.
 * Duplicate keys passed directly to build are excluded: the source Map first
 * resolves them, since duplicate raw build entries have no contract here.
 */

const probeValues: Array<IndexValue> = [-3, -2, -1, -0, 0, 1, 2, 3, 99]

const rangeBoundaries: Array<IndexValue> = [-2, 0, 2]

function groupKeysByValue<T>(
  rows: ReadonlyMap<string, T>,
): Map<T, Set<string>> {
  const groups = new Map<T, Set<string>>()
  for (const [key, value] of rows) {
    const keys = groups.get(value)
    if (keys) {
      keys.add(key)
    } else {
      groups.set(value, new Set([key]))
    }
  }
  return groups
}

function expectIndexMatchesModel(
  index: BaseIndex<string>,
  rows: Map<string, IndexValue>,
): void {
  const groups = groupKeysByValue(rows)
  const orderedKeys = [...groups]
    .sort(([left], [right]) => left - right)
    .flatMap(([, keys]) => [...keys].sort())

  expect(index.keyCount).toBe(rows.size)
  // Complete returned arrays preserve key multiplicity and comparator order
  // without requiring a particular bucket or ordered-storage representation.
  expect(index.takeFromStart(rows.size + 1)).toEqual(orderedKeys)
  expect(index.takeReversedFromEnd(rows.size + 1)).toEqual(
    [...orderedKeys].reverse(),
  )

  for (const value of probeValues) {
    const expected = groups.get(value) ?? new Set()
    expect(index.equalityLookup(value)).toEqual(expected)
    expect(index.lookup(`eq`, value)).toEqual(expected)
  }

  for (const boundary of rangeBoundaries) {
    const keysAtOrAbove = new Set(
      [...rows].filter(([, value]) => value >= boundary).map(([key]) => key),
    )
    const keysAtOrBelow = new Set(
      [...rows].filter(([, value]) => value <= boundary).map(([key]) => key),
    )

    expect(index.rangeQuery({ from: boundary })).toEqual(keysAtOrAbove)
    expect(index.rangeQuery({ to: boundary })).toEqual(keysAtOrBelow)
    // The model has no lower predicate here. An inclusivity flag cannot
    // exclude the minimum when the caller supplied no lower bound.
    expect(index.rangeQuery({ to: boundary, fromInclusive: false })).toEqual(
      keysAtOrBelow,
    )
    // Supplying the lower bound changes the model predicate. Keys at that
    // bound are excluded, while later keys through the upper bound remain.
    expect(
      index.rangeQuery({ from: boundary, to: 2, fromInclusive: false }),
    ).toEqual(
      new Set(
        [...rows]
          .filter(([, value]) => value > boundary && value <= 2)
          .map(([key]) => key),
      ),
    )
    expect(index.rangeQueryReversed({ from: boundary })).toEqual(keysAtOrBelow)
    expect(index.rangeQueryReversed({ to: boundary })).toEqual(keysAtOrAbove)
  }
  expect(index.rangeQueryReversed({})).toEqual(new Set(rows.keys()))
}

type GroupRow<T> = Readonly<{ key: string; value: T; groupId: number }>

// groupId is a model-only label for values equal under the comparator. The
// production index receives value objects and a comparator, not this label.
// Handles preserve exact identity; expected memberships come only from live
// descriptors. Keep retired handles so a stale bucket cannot leave the query set.
function expectExactIdentities<T>(
  index: Pick<BaseIndex<string>, `equalityLookup`>,
  rows: ReadonlyArray<GroupRow<T>>,
  identities: ReadonlyArray<T>,
): void {
  for (const value of identities) {
    expect(index.equalityLookup(value)).toEqual(
      new Set(rows.filter((row) => row.value === value).map((row) => row.key)),
    )
  }
}

function expectCustomGroups(
  index: BaseIndex<string>,
  rows: ReadonlyArray<GroupRow<{ groupId: number; position: number }>>,
  identities: ReadonlyArray<{ groupId: number; position: number }>,
): void {
  // groupId belongs to an immutable descriptor, never to the driver payload.
  const ordered = [...rows].sort(
    (left, right) =>
      left.groupId - right.groupId ||
      (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
  )
  const forward = ordered.map(({ key }) => key)
  expect(index.keyCount).toBe(rows.length)
  expect(index.takeFromStart(rows.length + 1)).toEqual(forward)
  expect(index.takeReversedFromEnd(rows.length + 1)).toEqual(
    [...forward].reverse(),
  )
  expectExactIdentities(index, rows, identities)
  for (const row of rows) {
    expect(index.rangeQuery({ from: row.value, to: row.value })).toEqual(
      new Set(
        rows
          .filter((candidate) => candidate.groupId === row.groupId)
          .map(({ key }) => key),
      ),
    )
  }
}

describe.each(indexTypes)(`%s update properties`, (_indexName, IndexType) => {
  test.each([20260930, undefined])(
    `matches a reference model across valid operation sequences (seed %s)`,
    async (seed) => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(arbitraryAction, { minLength: 1, maxLength: 100 }),
          async (actions) => {
            const index = new IndexType(1, new PropRef([`value`]))
            const rows = new Map<string, IndexValue>()

            expectIndexMatchesModel(index, rows)
            // Required replacement/continuation cuts precede the shrinkable tail.
            const required: Array<IndexAction> = [
              { type: `put`, key: `old`, value: -3 },
              { type: `build`, entries: [[`new`, 1]] },
              { type: `put`, key: `new`, value: 2 },
              { type: `delete`, key: `new` },
              { type: `put`, key: `old`, value: 3 },
              { type: `build`, entries: [] },
              { type: `put`, key: `old`, value: -2 },
            ]
            for (const action of [...required, ...actions]) {
              if (action.type === `put`) {
                if (rows.has(action.key)) {
                  index.update(
                    action.key,
                    { value: rows.get(action.key) },
                    { value: action.value },
                  )
                } else {
                  index.add(action.key, { value: action.value })
                }
                rows.set(action.key, action.value)
              } else if (action.type === `build`) {
                // Duplicate generated keys are resolved in the input world, not by
                // assuming any policy for invalid duplicate build entries.
                const replacement = new Map(action.entries)
                index.build(
                  [...replacement].map(([key, value]) => [key, { value }]),
                )
                rows.clear()
                for (const [key, value] of replacement) rows.set(key, value)
              } else if (rows.has(action.key)) {
                index.remove(action.key, { value: rows.get(action.key) })
                rows.delete(action.key)
              }

              expectIndexMatchesModel(index, rows)
            }

            const rebuilt = new IndexType(2, new PropRef([`value`]))
            rebuilt.build(
              [...rows].map(([key, value]) => [key, { value }] as const),
            )
            expectIndexMatchesModel(rebuilt, rows)
          },
        ),
        {
          ...(seed === undefined
            ? oraclePropertyOptions(100, `index-update.reference-model`)
            : { seed, numRuns: oracleRuns(100) }),
          examples: [
            [
              [
                { type: `put`, key: `0`, value: 1 },
                { type: `build`, entries: [[`1`, -1]] },
                { type: `put`, key: `1`, value: 2 },
              ],
            ],
            [
              [
                { type: `put`, key: `0`, value: 0 },
                { type: `put`, key: `1`, value: -0 },
              ],
            ],
          ],
        },
      )
    },
  )
  test.each([
    [`duplicate key`, `takeFromStart`, [`a`, `a`]],
    [`wrong reverse order`, `takeReversedFromEnd`, [`a`, `b`]],
  ] as const)(`full traversal rejects a %s`, (_name, method, wrongKeys) => {
    const index = new IndexType(1, new PropRef([`value`]))
    index.add(`a`, { value: 1 })
    index.add(`b`, { value: 2 })
    const wrongOutput = vi.spyOn(index, method).mockReturnValue([...wrongKeys])
    try {
      expect(() =>
        expectIndexMatchesModel(
          index,
          new Map([
            [`a`, 1],
            [`b`, 2],
          ]),
        ),
      ).toThrowError(/expected/)
      expect(wrongOutput).toHaveBeenCalled()
    } finally {
      wrongOutput.mockRestore()
    }
  })
  test(`inclusive lower bound rejects an exclusive-boundary result`, () => {
    const index = new IndexType(1, new PropRef([`value`]))
    index.add(`boundary`, { value: -2 })
    const rangeQuery = index.rangeQuery.bind(index)
    const wrongOutput = vi
      .spyOn(index, `rangeQuery`)
      .mockImplementation((options) =>
        options.from === -2 ? new Set() : rangeQuery(options),
      )
    try {
      expect(() =>
        expectIndexMatchesModel(index, new Map([[`boundary`, -2]])),
      ).toThrowError(/expected/)
    } finally {
      wrongOutput.mockRestore()
    }
  })
  test(`upper-only range rejects a dropped minimum when the lower flag is exclusive`, () => {
    const index = new IndexType(1, new PropRef([`value`]))
    index.add(`minimum`, { value: -2 })
    const rangeQuery = index.rangeQuery.bind(index)
    const wrongOutput = vi
      .spyOn(index, `rangeQuery`)
      .mockImplementation((options) => {
        const result = rangeQuery(options)
        if (!(`from` in options) && options.fromInclusive === false) {
          result.delete(`minimum`)
        }
        return result
      })
    try {
      expect(() =>
        expectIndexMatchesModel(index, new Map([[`minimum`, -2]])),
      ).toThrowError(/expected/)
    } finally {
      wrongOutput.mockRestore()
    }
  })
  test(`explicit exclusive lower bound rejects an included boundary value`, () => {
    const index = new IndexType(1, new PropRef([`value`]))
    index.add(`boundary`, { value: -2 })
    index.add(`later`, { value: 0 })
    const rangeQuery = index.rangeQuery.bind(index)
    const wrongOutput = vi
      .spyOn(index, `rangeQuery`)
      .mockImplementation((options) => {
        const result = rangeQuery(options)
        if (
          options.from === -2 &&
          options.to === 2 &&
          options.fromInclusive === false
        ) {
          result.add(`boundary`)
        }
        return result
      })
    try {
      expect(() =>
        expectIndexMatchesModel(
          index,
          new Map([
            [`boundary`, -2],
            [`later`, 0],
          ]),
        ),
      ).toThrowError(/expected/)
    } finally {
      wrongOutput.mockRestore()
    }
  })
})

/**
 * Direct index equality keeps `undefined` and `null` in distinct exact-value
 * buckets, even though the default ordering comparator places both at one
 * position. An `IN` lookup returns the union of the requested exact-value
 * memberships, including every owner of a repeated value and no unrequested
 * value. The established direct-index tests exercise these methods. This law
 * does not describe the live-query WHERE evaluator, which uses three-valued
 * nullish equality.
 *
 * A source Map predicts membership without index normalization or comparator
 * classification. Fresh singleton histories preserve the old update cuts;
 * coexisting values expose a wrong union of nullish buckets. Fixed histories
 * also retain two undefined owners beside strings, a nonempty state without
 * undefined, and both mixed and undefined-only `IN` lists. A fixed build
 * history starts with `undefined` and 1 in both source orders, then continues
 * with an add; it distinguishes full rebuild from incremental insertion.
 * The generated tail
 * adds nearby put/delete/build histories over three keys and five values, with both
 * orders of a mixed `IN` list, while a fixed four-key history keeps a third
 * defined distractor. An absent source key is added, while an owned key is
 * updated. A direct update of an absent key is outside this grammar. Each
 * nullish value is needed to distinguish the buckets. Defined values exercise
 * mixed-list selection and moves across the nullish boundary. At least two
 * keys are needed to expose surviving peers.
 * After each direct action returns, exact and `IN` methods, their `lookup`
 * dispatches, unfiltered ordered reads, selected forward ranges, and key count must agree with
 * the Map. The default comparator puts null and undefined at one ordered
 * position before the positive numbers in this bounded domain, although
 * exact lookup keeps them apart. Endpoint reads start at an end; an explicit
 * cursor excludes its entire comparator position. Range bounds constrain
 * positions only when supplied, even when the supplied value is undefined.
 * The source Map is sorted anew for ordered reads and filtered for ranges;
 * neither expectation uses the production comparator or traversal. Fixed
 * histories keep three undefined owners, a remove-one-of-two cut, a mixed
 * four-row range, and explicit versus omitted lower bounds. The generated
 * tail varies owners and values at each returned-action cut. Build replaces
 * source ownership; duplicate generated keys are resolved by the Map before
 * invoking production, so a raw duplicate-entry build is excluded. Removing
 * build loses the native-sort path; removing the
 * nullish values loses the boundary distinction, one owner loses repeated
 * bucket traversal, and one defined value loses cursor continuation. Values
 * outside the positive 1..3 domain, mixed-type numeric/string order, custom options,
 * reverse ranges, all bound combinations, filtered takes, bucket object
 * identity, and instrumentation are outside this ordered and range claim.
 */
type NullishIndexValue = number | null | undefined

type NullishIndexAction =
  | { type: `put`; key: string; value: NullishIndexValue }
  | { type: `delete`; key: string }
  | { type: `build`; entries: Array<[string, NullishIndexValue]> }

const nullishProbeValues: ReadonlyArray<NullishIndexValue> = [
  undefined,
  null,
  1,
  2,
  3,
]

const nullishInProbes: ReadonlyArray<ReadonlyArray<NullishIndexValue>> = [
  [],
  [undefined],
  [null],
  [undefined, 1],
  [1, undefined],
  [undefined, null],
  [3],
  [1, 2],
  [1, 1],
]

const arbitraryNullishAction: fc.Arbitrary<NullishIndexAction> = fc.oneof(
  fc.record({
    type: fc.constant(`put` as const),
    key: fc.constantFrom(`a`, `b`, `c`),
    value: fc.constantFrom(...nullishProbeValues),
  }),
  fc.record({
    type: fc.constant(`delete` as const),
    key: fc.constantFrom(`a`, `b`, `c`),
  }),
  fc.record({
    type: fc.constant(`build` as const),
    entries: fc.array(
      fc.tuple(
        fc.constantFrom(`a`, `b`, `c`),
        fc.constantFrom(...nullishProbeValues),
      ),
      { maxLength: 3 },
    ),
  }),
)

function expectExactMembership<T>(
  index: BaseIndex<string>,
  rows: ReadonlyMap<string, T>,
  exactProbes: ReadonlyArray<T>,
  inProbes: ReadonlyArray<ReadonlyArray<T>>,
): void {
  // Map key identity distinguishes null from undefined without consulting the
  // index's normalized keys or its ordering comparator. IN membership follows
  // from source-value membership in the operand list, including an empty list.
  const groups = groupKeysByValue(rows)
  expect(index.keyCount).toBe(rows.size)
  const traversedKeys = index.takeFromStart(rows.size + 1)
  expect(traversedKeys).toHaveLength(rows.size)
  expect(new Set(traversedKeys)).toEqual(new Set(rows.keys()))
  for (const value of exactProbes) {
    const expected = groups.get(value) ?? new Set<string>()
    expect(index.equalityLookup(value)).toEqual(expected)
    expect(index.lookup(`eq`, value)).toEqual(expected)
  }
  for (const values of inProbes) {
    const expected = new Set(
      [...rows]
        .filter(([, value]) => values.includes(value))
        .map(([key]) => key),
    )
    expect(index.inArrayLookup([...values])).toEqual(expected)
    expect(index.lookup(`in`, [...values])).toEqual(expected)
  }
}

function expectNullishMembership(
  index: BaseIndex<string>,
  rows: ReadonlyMap<string, NullishIndexValue>,
): void {
  expectExactMembership(index, rows, nullishProbeValues, nullishInProbes)
  expectNullishOrderedReads(index, rows)
}

type ModelBound = Readonly<{
  value: NullishIndexValue
  inclusive: boolean
}>

type ModelRange = Readonly<{
  lower?: ModelBound
  upper?: ModelBound
  unusedLowerInclusive?: false
}>

const nullishRangeProbes: ReadonlyArray<ModelRange> = [
  {},
  { upper: { value: 2, inclusive: true } },
  { upper: { value: 2, inclusive: true }, unusedLowerInclusive: false },
  {
    lower: { value: undefined, inclusive: true },
    upper: { value: 2, inclusive: true },
  },
  {
    lower: { value: undefined, inclusive: false },
    upper: { value: 2, inclusive: true },
  },
  {
    lower: { value: undefined, inclusive: true },
    upper: { value: undefined, inclusive: true },
  },
  {
    lower: { value: null, inclusive: true },
    upper: { value: null, inclusive: true },
  },
  { lower: { value: null, inclusive: false } },
  { upper: { value: undefined, inclusive: false } },
  {
    lower: { value: 1, inclusive: true },
    upper: { value: 2, inclusive: false },
  },
]

// "Position" is a model label, not a stored index bucket. In the declared
// domain 1..3, zero names the shared nullish comparator position. Source key
// ownership remains in the Map even when two values share that position.
function nullishPosition(value: NullishIndexValue): number {
  return value === null || value === undefined ? 0 : value
}

function expectNullishOrderedReads(
  index: BaseIndex<string>,
  rows: ReadonlyMap<string, NullishIndexValue>,
): void {
  const ordered = [...rows]
    .sort(
      ([leftKey, leftValue], [rightKey, rightValue]) =>
        nullishPosition(leftValue) - nullishPosition(rightValue) ||
        (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0),
    )
    .map(([key, value]) => ({ key, value }))

  // The public arrays preserve both ordering and multiplicity. A set-only
  // check would miss a repeated undefined owner or a skipped peer.
  for (const n of [1, 3, 10]) {
    expect(index.takeFromStart(n)).toEqual(
      ordered.slice(0, n).map(({ key }) => key),
    )
    expect(index.takeReversedFromEnd(n)).toEqual(
      [...ordered]
        .reverse()
        .slice(0, n)
        .map(({ key }) => key),
    )
    for (const cursor of nullishProbeValues) {
      const cursorPosition = nullishPosition(cursor)
      expect(index.take(n, cursor)).toEqual(
        ordered
          .filter(({ value }) => nullishPosition(value) > cursorPosition)
          .slice(0, n)
          .map(({ key }) => key),
      )
      expect(index.takeReversed(n, cursor)).toEqual(
        [...ordered]
          .reverse()
          .filter(({ value }) => nullishPosition(value) < cursorPosition)
          .slice(0, n)
          .map(({ key }) => key),
      )
    }
  }

  // Model bounds are separate objects, so an absent lower bound is not
  // conflated with a present bound whose value is literally undefined.
  for (const probe of nullishRangeProbes) {
    const options = {
      ...(probe.lower && {
        from: probe.lower.value,
        fromInclusive: probe.lower.inclusive,
      }),
      ...(probe.upper && {
        to: probe.upper.value,
        toInclusive: probe.upper.inclusive,
      }),
      ...(probe.unusedLowerInclusive === false && { fromInclusive: false }),
    }
    const expected = new Set(
      ordered
        .filter(({ value }) => {
          const position = nullishPosition(value)
          const lower = probe.lower
          const upper = probe.upper
          return (
            (lower === undefined ||
              (lower.inclusive
                ? position >= nullishPosition(lower.value)
                : position > nullishPosition(lower.value))) &&
            (upper === undefined ||
              (upper.inclusive
                ? position <= nullishPosition(upper.value)
                : position < nullishPosition(upper.value)))
          )
        })
        .map(({ key }) => key),
    )
    expect(index.rangeQuery(options)).toEqual(expected)
  }
}

function applyNullishAction(
  index: BaseIndex<string>,
  rows: Map<string, NullishIndexValue>,
  action: NullishIndexAction,
): void {
  // The driver maps source ownership to the real add, update, and remove API.
  if (action.type === `put`) {
    if (rows.has(action.key)) {
      index.update(
        action.key,
        { value: rows.get(action.key) },
        { value: action.value },
      )
    } else {
      index.add(action.key, { value: action.value })
    }
    rows.set(action.key, action.value)
  } else if (action.type === `build`) {
    // Resolve duplicate generated source keys before calling build; their raw
    // duplicate-entry policy is outside this law. Build replaces the Map.
    const replacement = new Map(action.entries)
    index.build([...replacement].map(([key, value]) => [key, { value }]))
    rows.clear()
    for (const [key, value] of replacement) rows.set(key, value)
  } else if (rows.has(action.key)) {
    index.remove(action.key, { value: rows.get(action.key) })
    rows.delete(action.key)
  }
  expectNullishMembership(index, rows)
}

declareOracle({
  check: [
    expectIndexMatchesModel,
    expectCustomGroups,
    expectExactIdentities,
    expectExactMembership,
    expectNullishMembership,
    expectComparatorStepRefines,
    expectPublishedKeysMatchCollection,
    expectStringMembershipMatches,
    expectSnapshotKeysMatchSource,
    expectBinaryValueMembership,
    expectConservedIndexKeys,
  ],
  model: [groupKeysByValue, nullishPosition, predictMonthDayOwners],
})

describe.each(indexTypes)(
  `%s nullish direct index refinement`,
  (_indexName, IndexType) => {
    test.each([
      [`undefined to null`, undefined, null],
      [`null to undefined`, null, undefined],
      [`defined to undefined`, 1, undefined],
      [`undefined to defined`, undefined, 1],
      [`undefined to undefined`, undefined, undefined],
    ] as const)(`keeps membership after %s`, (_label, before, after) => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      applyNullishAction(index, rows, { type: `put`, key: `a`, value: before })
      applyNullishAction(index, rows, { type: `put`, key: `a`, value: after })
    })

    test(`keeps coexisting null and undefined buckets distinct`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      for (const [key, value] of [
        [`null1`, null],
        [`undef1`, undefined],
        [`num1`, 1],
      ] as const) {
        applyNullishAction(index, rows, { type: `put`, key, value })
      }
    })

    test(`finds every undefined owner beside distinct string values`, () => {
      const index = new IndexType(1, new PropRef([`status`]))
      const rows = new Map<string, string | undefined>()
      const exactProbes = [undefined, `active`, `inactive`]
      const inProbes = [[undefined], [undefined, `active`]]
      for (const [key, value] of [
        [`a`, `active`],
        [`b`, undefined],
        [`c`, `inactive`],
        [`d`, undefined],
      ] as const) {
        index.add(key, { status: value })
        rows.set(key, value)
        expectExactMembership(index, rows, exactProbes, inProbes)
      }
    })

    test(`returns no undefined key from a nonempty all-defined index`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      applyNullishAction(index, rows, { type: `put`, key: `a`, value: 1 })
      applyNullishAction(index, rows, { type: `put`, key: `b`, value: 2 })
    })

    test(`unites undefined and defined IN members without distractors`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      for (const [key, value] of [
        [`undef`, undefined],
        [`one`, 1],
        [`two`, 2],
        [`three`, 3],
      ] as const) {
        applyNullishAction(index, rows, { type: `put`, key, value })
      }
    })

    test(`returns every undefined owner from a singleton IN list`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      for (const [key, value] of [
        [`undef1`, undefined],
        [`undef2`, undefined],
        [`one`, 1],
      ] as const) {
        applyNullishAction(index, rows, { type: `put`, key, value })
      }
    })

    test(`distinguishes endpoint reads from explicit undefined cursors`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      for (const [key, value] of [
        [`a`, undefined],
        [`b`, 1],
        [`c`, 2],
      ] as const) {
        applyNullishAction(index, rows, { type: `put`, key, value })
      }
    })

    test(`traverses every undefined owner before continuing to numbers`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      for (const [key, value] of [
        [`undef1`, undefined],
        [`undef2`, undefined],
        [`undef3`, undefined],
        [`one`, 1],
        [`two`, 2],
      ] as const) {
        applyNullishAction(index, rows, { type: `put`, key, value })
      }
    })

    test(`retains the second undefined owner after removing the first`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      applyNullishAction(index, rows, {
        type: `put`,
        key: `a`,
        value: undefined,
      })
      applyNullishAction(index, rows, {
        type: `put`,
        key: `b`,
        value: undefined,
      })
      applyNullishAction(index, rows, { type: `delete`, key: `a` })
    })

    test(`distinguishes explicit and omitted undefined lower bounds`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      for (const [key, value] of [
        [`undef`, undefined],
        [`one`, 1],
        [`two`, 2],
        [`three`, 3],
      ] as const) {
        applyNullishAction(index, rows, { type: `put`, key, value })
      }
    })

    test(`includes both undefined owners within double undefined bounds`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      for (const [key, value] of [
        [`a`, undefined],
        [`b`, undefined],
        [`c`, 1],
      ] as const) {
        applyNullishAction(index, rows, { type: `put`, key, value })
      }
    })

    test(`build preserves nulls-first ordered reads and ranges`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      applyNullishAction(index, rows, {
        type: `build`,
        entries: [
          [`undefined`, undefined],
          [`one`, 1],
        ],
      })
      // A second build changes insertion order; the model still predicts the
      // same returned key order and complete upper-bound results.
      applyNullishAction(index, rows, {
        type: `build`,
        entries: [
          [`one`, 1],
          [`undefined`, undefined],
        ],
      })
      applyNullishAction(index, rows, {
        type: `put`,
        key: `two`,
        value: 2,
      })
      applyNullishAction(index, rows, {
        type: `build`,
        entries: [
          [`undef2`, undefined],
          [`null`, null],
          [`undef1`, undefined],
          [`one`, 1],
        ],
      })
    })

    test.each([20261012, undefined])(
      `refines nullish membership histories (seed %s)`,
      async (seed) => {
        await fc.assert(
          fc.asyncProperty(
            fc.array(arbitraryNullishAction, { minLength: 1, maxLength: 40 }),
            async (actions) => {
              const index = new IndexType(1, new PropRef([`value`]))
              const rows = new Map<string, NullishIndexValue>()
              expectNullishMembership(index, rows)
              for (const action of actions) {
                applyNullishAction(index, rows, action)
              }
            },
          ),
          seed === undefined
            ? oraclePropertyOptions(100, `index-update.nullish-membership`)
            : { seed, numRuns: oracleRuns(100) },
        )
      },
    )

    test(`rejects a skipped undefined-to-null update`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      applyNullishAction(index, rows, {
        type: `put`,
        key: `a`,
        value: undefined,
      })
      const skipped = vi.spyOn(index, `update`).mockImplementation(() => {})
      try {
        expect(() =>
          applyNullishAction(index, rows, {
            type: `put`,
            key: `a`,
            value: null,
          }),
        ).toThrowError(/expected/)
        expect(skipped).toHaveBeenCalledOnce()
      } finally {
        skipped.mockRestore()
      }
    })

    test(`rejects lookup dispatch that unites nullish buckets`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      applyNullishAction(index, rows, {
        type: `put`,
        key: `null1`,
        value: null,
      })
      applyNullishAction(index, rows, {
        type: `put`,
        key: `undef1`,
        value: undefined,
      })
      const lookup = index.lookup.bind(index)
      const united = vi
        .spyOn(index, `lookup`)
        .mockImplementation((op, value) =>
          op === `eq` && value === undefined
            ? new Set([`null1`, `undef1`])
            : lookup(op, value),
        )
      try {
        expect(() => expectNullishMembership(index, rows)).toThrowError(
          /expected/,
        )
        expect(united).toHaveBeenCalledWith(`eq`, undefined)
      } finally {
        united.mockRestore()
      }
    })

    test(`rejects an exact lookup that loses one undefined owner`, () => {
      const index = new IndexType(1, new PropRef([`status`]))
      const rows = new Map<string, string | undefined>([
        [`a`, `active`],
        [`b`, undefined],
        [`c`, `inactive`],
        [`d`, undefined],
      ])
      for (const [key, status] of rows) index.add(key, { status })
      const lookup = index.equalityLookup.bind(index)
      const truncated = vi
        .spyOn(index, `equalityLookup`)
        .mockImplementation((value) =>
          value === undefined ? new Set([`b`]) : lookup(value),
        )
      try {
        expect(() =>
          expectExactMembership(index, rows, [undefined], [[undefined]]),
        ).toThrowError(/expected/)
        expect(truncated).toHaveBeenCalledWith(undefined)
      } finally {
        truncated.mockRestore()
      }
    })

    test(`rejects an IN lookup that drops an undefined operand`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      applyNullishAction(index, rows, {
        type: `put`,
        key: `undef`,
        value: undefined,
      })
      applyNullishAction(index, rows, { type: `put`, key: `one`, value: 1 })
      const lookup = index.inArrayLookup.bind(index)
      const dropped = vi
        .spyOn(index, `inArrayLookup`)
        .mockImplementation((values) =>
          values.length === 2 && values[0] === 1 && values[1] === undefined
            ? new Set([`one`])
            : lookup(values),
        )
      try {
        expect(() => expectNullishMembership(index, rows)).toThrowError(
          /expected/,
        )
        expect(dropped).toHaveBeenCalledWith([1, undefined])
      } finally {
        dropped.mockRestore()
      }
    })

    test(`rejects an IN lookup that loses a same-value owner`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      applyNullishAction(index, rows, {
        type: `put`,
        key: `undef1`,
        value: undefined,
      })
      applyNullishAction(index, rows, {
        type: `put`,
        key: `undef2`,
        value: undefined,
      })
      const lookup = index.inArrayLookup.bind(index)
      const truncated = vi
        .spyOn(index, `inArrayLookup`)
        .mockImplementation((values) =>
          values.length === 1 && values[0] === undefined
            ? new Set([`undef1`])
            : lookup(values),
        )
      try {
        expect(() => expectNullishMembership(index, rows)).toThrowError(
          /expected/,
        )
        expect(truncated).toHaveBeenCalledWith([undefined])
      } finally {
        truncated.mockRestore()
      }
    })

    test(`rejects IN dispatch that returns only its first value group`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>()
      applyNullishAction(index, rows, {
        type: `put`,
        key: `undef`,
        value: undefined,
      })
      applyNullishAction(index, rows, { type: `put`, key: `one`, value: 1 })
      const lookup = index.lookup.bind(index)
      const firstOnly = vi
        .spyOn(index, `lookup`)
        .mockImplementation((op, value) =>
          op === `in` &&
          Array.isArray(value) &&
          value.length === 2 &&
          value[0] === undefined &&
          value[1] === 1
            ? new Set([`undef`])
            : lookup(op, value),
        )
      try {
        expect(() => expectNullishMembership(index, rows)).toThrowError(
          /expected/,
        )
        expect(firstOnly).toHaveBeenCalledWith(`in`, [undefined, 1])
      } finally {
        firstOnly.mockRestore()
      }
    })

    test(`rejects an endpoint read that drops the undefined owner`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>([
        [`a`, undefined],
        [`b`, 1],
        [`c`, 2],
      ])
      for (const [key, value] of rows) index.add(key, { value })
      const dropped = vi
        .spyOn(index, `takeFromStart`)
        .mockImplementation(() => [`b`, `c`])
      try {
        expect(() => expectNullishOrderedReads(index, rows)).toThrowError(
          /expected/,
        )
        expect(dropped).toHaveBeenCalled()
      } finally {
        dropped.mockRestore()
      }
    })

    test(`rejects a cursor that repeats the last undefined owner`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>([
        [`undef1`, undefined],
        [`undef2`, undefined],
        [`undef3`, undefined],
        [`one`, 1],
        [`two`, 2],
      ])
      for (const [key, value] of rows) index.add(key, { value })
      const take = index.take.bind(index)
      const repeated = vi
        .spyOn(index, `take`)
        .mockImplementation((n, from, filter) =>
          n === 10 && from === undefined
            ? [`undef3`, `one`, `two`]
            : take(n, from, filter),
        )
      try {
        expect(() => expectNullishOrderedReads(index, rows)).toThrowError(
          /expected/,
        )
        expect(repeated).toHaveBeenCalledWith(10, undefined)
      } finally {
        repeated.mockRestore()
      }
    })

    test(`rejects a forward range that drops an explicit undefined lower bound`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>([
        [`undef`, undefined],
        [`one`, 1],
        [`two`, 2],
        [`three`, 3],
      ])
      for (const [key, value] of rows) index.add(key, { value })
      const rangeQuery = index.rangeQuery.bind(index)
      const dropped = vi
        .spyOn(index, `rangeQuery`)
        .mockImplementation((options) =>
          `from` in options &&
          options.from === undefined &&
          options.to === 2 &&
          options.fromInclusive === true
            ? new Set([`one`, `two`])
            : rangeQuery(options),
        )
      try {
        expect(() => expectNullishOrderedReads(index, rows)).toThrowError(
          /expected/,
        )
        expect(dropped).toHaveBeenCalledWith({
          from: undefined,
          fromInclusive: true,
          to: 2,
          toInclusive: true,
        })
      } finally {
        dropped.mockRestore()
      }
    })

    test(`rejects a double undefined range that loses one owner`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>([
        [`a`, undefined],
        [`b`, undefined],
        [`c`, 1],
      ])
      for (const [key, value] of rows) index.add(key, { value })
      const rangeQuery = index.rangeQuery.bind(index)
      const truncated = vi
        .spyOn(index, `rangeQuery`)
        .mockImplementation((options) =>
          `from` in options &&
          options.from === undefined &&
          `to` in options &&
          options.to === undefined
            ? new Set([`a`])
            : rangeQuery(options),
        )
      try {
        expect(() => expectNullishOrderedReads(index, rows)).toThrowError(
          /expected/,
        )
        expect(truncated).toHaveBeenCalledWith({
          from: undefined,
          fromInclusive: true,
          to: undefined,
          toInclusive: true,
        })
      } finally {
        truncated.mockRestore()
      }
    })

    test(`rejects a null bound that drops its undefined peer`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, NullishIndexValue>([
        [`a`, undefined],
        [`b`, null],
        [`c`, 1],
      ])
      for (const [key, value] of rows) index.add(key, { value })
      const rangeQuery = index.rangeQuery.bind(index)
      const exactOnly = vi
        .spyOn(index, `rangeQuery`)
        .mockImplementation((options) =>
          `from` in options &&
          options.from === null &&
          `to` in options &&
          options.to === null
            ? new Set([`b`])
            : rangeQuery(options),
        )
      try {
        expect(() => expectNullishOrderedReads(index, rows)).toThrowError(
          /expected/,
        )
        expect(exactOnly).toHaveBeenCalledWith({
          from: null,
          fromInclusive: true,
          to: null,
          toInclusive: true,
        })
      } finally {
        exactOnly.mockRestore()
      }
    })
  },
)

/**
 * Refinement check for one operation under the invalid-comparator law. The
 * recorder counts invalid comparator results made while `run` executes. The
 * operation must throw a comparator TypeError exactly when that count is
 * nonzero. Returns whether the operation crashed.
 */
function expectComparatorStepRefines(
  recorder: { invalidResults: number },
  run: () => unknown,
): boolean {
  recorder.invalidResults = 0
  let error: unknown
  try {
    run()
  } catch (caught) {
    error = caught
  }
  if (recorder.invalidResults === 0) {
    expect(error).toBeUndefined()
    return false
  }
  expect(error).toBeInstanceOf(TypeError)
  expect((error as Error).message).toMatch(/comparator/)
  return true
}

describe.each(indexTypes)(
  `%s invalid comparator results`,
  (_name, IndexType) => {
    const comparators: Array<{
      name: string
      compare: (left: any, right: any) => unknown
      // Whether the comparator orders numbers, so the numeric model can
      // observe the index after a rejected write.
      ordersNumbers: boolean
    }> = [
      {
        name: `subtraction`,
        compare: (left, right) => left - right,
        ordersNumbers: true,
      },
      {
        name: `boolean`,
        compare: (left, right) => left > right,
        ordersNumbers: false,
      },
      {
        name: `signed infinity`,
        compare: (left, right) =>
          left === right ? 0 : left < right ? -Infinity : Infinity,
        ordersNumbers: true,
      },
    ]
    const probes: Array<{
      name: string
      run: (index: BaseIndex<string>, size: number) => unknown
      atomic?: true
    }> = [
      {
        name: `add`,
        run: (index) => index.add(`ann`, { value: `ann` }),
        atomic: true,
      },
      {
        name: `update`,
        run: (index) => index.update(`0`, { value: 0 }, { value: `ann` }),
      },
      { name: `gt`, run: (index) => index.lookup(`gt`, `ann`) },
      { name: `lte`, run: (index) => index.lookup(`lte`, `ann`) },
      { name: `take`, run: (index) => index.take(3, `ann`) },
      { name: `takeReversed`, run: (index) => index.takeReversed(3, `ann`) },
      {
        name: `build`,
        run: (index, size) =>
          index.build([
            ...Array.from({ length: size }, (_, value): [string, object] => [
              String(value),
              { value },
            ]),
            [`ann`, { value: `ann` }],
          ]),
      },
    ]
    function createRecordedIndex(compare: (left: any, right: any) => unknown) {
      const recorder = { invalidResults: 0 }
      const index = new IndexType(1, new PropRef([`value`]), undefined, {
        compareFn: (left, right) => {
          const result = compare(left, right)
          if (typeof result !== `number` || Number.isNaN(result))
            recorder.invalidResults++
          return result as number
        },
      })
      const step = (run: () => unknown): boolean =>
        expectComparatorStepRefines(recorder, run)
      return { index, step }
    }
    describe.each(comparators)(
      `$name comparator`,
      ({ compare, ordersNumbers }) => {
        describe.each(probes)(`$name`, ({ run, atomic }) => {
          test.each([0, 1, 4, 5, 32, 33, 65])(
            `throws exactly when it receives an invalid result after %s rows`,
            (size) => {
              const { index, step } = createRecordedIndex(compare)
              const rows = new Map<string, IndexValue>()
              for (let value = 0; value < size; value++) {
                if (step(() => index.add(String(value), { value }))) return
                rows.set(String(value), value)
              }
              if (step(() => run(index, size)) && atomic && ordersNumbers)
                expectIndexMatchesModel(index, rows)
            },
          )
        })
      },
    )
    test(`crashes at the second write of the reported string rows`, () => {
      const { index, step } = createRecordedIndex((left, right) => left - right)
      expect(step(() => index.add(`1`, { value: `ann` }))).toBe(false)
      expect(step(() => index.add(`2`, { value: `bob` }))).toBe(true)
    })
    test(`a rejected remove leaves its row indexed`, () => {
      const { index, step } = createRecordedIndex((left, right) => left - right)
      expect(step(() => index.add(`x`, { value: `x` }))).toBe(false)
      expect(step(() => index.remove(`x`, { value: `x` }))).toBe(true)
      expect(index.keyCount).toBe(1)
      expect(index.lookup(`eq`, `x`)).toEqual(new Set([`x`]))
    })
    test(`a rejected remove preserves other exact values`, () => {
      const { index, step } = createRecordedIndex((left, right) =>
        left === `x` && right === `x`
          ? NaN
          : String(left).localeCompare(String(right)),
      )
      for (const value of [`a`, `x`, `z`]) {
        expect(step(() => index.add(value, { value }))).toBe(false)
      }
      expect(step(() => index.remove(`x`, { value: `x` }))).toBe(true)
      expect(index.keyCount).toBe(3)
      for (const value of [`a`, `x`, `z`]) {
        expect(index.lookup(`eq`, value)).toEqual(new Set([value]))
      }
    })
  },
)

/**
 * Collection boundary for the invalid-comparator law.
 *
 * The Collection writes its rows before it updates indexes and publishes
 * change events. An index throw in between would leave rows that subscribers
 * were never told about while the collection stays usable. That is partial
 * success, which `AGENTS.md` forbids. The collection crashes instead: after
 * the throwing write, its status is `error` and the next mutation throws
 * `CollectionInErrorStateError`.
 *
 * Model: until a write throws, the subscriber's accumulated keys equal the
 * collection's keys and the collection is ready.
 *
 * Grammar: index type x write path (optimistic insert, sync commit). Rows use
 * string names with a subtracting comparator. The first row compares nothing;
 * the second is the first invalid comparison.
 */
/**
 * Subscriber law at the Collection boundary: until a write throws, the keys
 * accumulated from published change events equal the Collection's live keys.
 */
function expectPublishedKeysMatchCollection(
  published: ReadonlySet<number>,
  collection: { keys: () => IterableIterator<number> },
): void {
  expect(published).toEqual(new Set(collection.keys()))
}

describe.each([
  [`BasicIndex`, BasicIndex],
  [`BTreeIndex`, BTreeIndex],
] as const)(
  `%s invalid comparator at the Collection boundary`,
  (_name, IndexType) => {
    type Row = { id: number; name: string }
    const writePaths: Array<{
      name: string
      write: (
        collection: ReturnType<typeof createNamedCollection>[`collection`],
        sync: () => SyncApi,
        row: Row,
      ) => void
    }> = [
      {
        name: `optimistic insert`,
        write: (collection, _sync, row) => collection.insert(row),
      },
      {
        name: `sync commit`,
        write: (_collection, sync, row) => {
          const api = sync()
          api.begin()
          api.write({ type: `insert`, value: row })
          api.commit()
        },
      },
    ]
    type SyncApi = {
      begin: () => void
      write: (message: { type: `insert`; value: Row }) => void
      commit: () => void
    }

    function createNamedCollection() {
      let syncApi: SyncApi | undefined
      const collection = createCollection<Row, number>({
        id: `invalid-comparator-boundary-${IndexType.name}`,
        getKey: (row) => row.id,
        startSync: true,
        sync: {
          sync: (api) => {
            syncApi = api as unknown as SyncApi
            api.markReady()
          },
        },
        onInsert: async () => {},
      })
      collection.createIndex((row) => row.name, {
        indexType: IndexType,
        options: { compareFn: (left: any, right: any) => left - right },
      })
      return { collection, sync: () => syncApi! }
    }

    test.each(writePaths)(
      `$name crashes the collection instead of publishing partial success`,
      async ({ write }) => {
        const { collection, sync } = createNamedCollection()
        await withCollectionCleanup(collection, () => {
          const published = new Set<number>()
          collection.subscribeChanges((changes) => {
            for (const change of changes)
              if (change.type === `delete`) published.delete(change.key)
              else published.add(change.key)
          })

          write(collection, sync, { id: 1, name: `ann` })
          expect(collection.status).toBe(`ready`)
          expectPublishedKeysMatchCollection(published, collection)

          expect(() => write(collection, sync, { id: 2, name: `bob` })).toThrow(
            TypeError,
          )
          expect(collection.status).toBe(`error`)
          expect(() => collection.insert({ id: 3, name: `cy` })).toThrow(
            CollectionInErrorStateError,
          )
        })
      },
    )
  },
)

/**
 * Exact string membership law for comparator groups: each exact value's
 * equality lookup and `eq` dispatch return the source keys holding that value,
 * and a range over its comparator group returns every key whose value shares
 * the group. The source Map and the group labels are the model; the comparator
 * is not consulted for exact membership.
 */
function expectStringMembershipMatches<Value extends string>(
  index: BaseIndex<string>,
  rows: ReadonlyMap<string, Value>,
  group: Readonly<Record<Value, number>>,
): void {
  expect(index.keyCount).toBe(rows.size)
  for (const value of Object.keys(group) as Array<Value>) {
    const exactKeys = new Set(
      [...rows].filter(([, current]) => current === value).map(([key]) => key),
    )
    expect(index.equalityLookup(value)).toEqual(exactKeys)
    expect(index.lookup(`eq`, value)).toEqual(exactKeys)
    expect(index.rangeQuery({ from: value, to: value })).toEqual(
      new Set(
        [...rows]
          .filter(([, current]) => group[current] === group[value])
          .map(([key]) => key),
      ),
    )
  }
}

describe.each(indexTypes)(`%s comparator groups`, (_indexName, IndexType) => {
  test(`rejects stale retired identity outputs without rejecting live reuse`, () => {
    const symbol = Symbol(`same group`)
    const retired = { key: `old`, groupId: 0, value: [symbol] }
    const live = { key: `live`, groupId: 0, value: [symbol] }
    const index = new IndexType(1, new PropRef([`value`]))
    index.add(retired.key, retired)
    index.add(live.key, live)
    index.remove(retired.key, retired)
    const identities = [retired.value, live.value]
    expectExactIdentities(index, [live], identities)
    const lookup = index.equalityLookup.bind(index)
    const wrongOutput = vi
      .spyOn(index, `equalityLookup`)
      .mockImplementation((value) =>
        value === retired.value ? new Set([retired.key]) : lookup(value),
      )
    try {
      // The former live-only observation accepts this stale retired bucket.
      expectExactIdentities(index, [live], [live.value])
      expect(() =>
        expectExactIdentities(index, [live], identities),
      ).toThrowError(/expected/)
    } finally {
      wrongOutput.mockRestore()
    }
    const reused = { ...retired, key: `reused` }
    index.add(reused.key, reused)
    expectExactIdentities(index, [live, reused], identities)
  })

  test(`rejects append-only replacement state and accepts replacement continuation`, () => {
    const index = new IndexType(1, new PropRef([`value`]))
    index.add(`old`, { value: -1 })
    index.add(`new`, { value: 1 })
    const replacement = new Map([[`new`, 1]])
    // This is the raw state an append-only build would expose, not a source mutant.
    expect(() => expectIndexMatchesModel(index, replacement)).toThrowError(
      /expected/,
    )
    index.build([[`new`, { value: 1 }]])
    expectIndexMatchesModel(index, replacement)
    index.update(`new`, { value: 1 }, { value: 2 })
    expectIndexMatchesModel(index, new Map([[`new`, 2]]))
  })

  test(`custom facts reject mutated payload groups and insertion-order ties`, () => {
    const rows = [1, 1, 2].map((groupId, position) =>
      Object.freeze({
        key: String(position),
        groupId,
        value: { groupId, position },
      }),
    )
    const identities = rows.map((row) => row.value)
    const index = new IndexType(1, new PropRef([`value`]), undefined, {
      compareFn: (left, right) =>
        (left as { groupId: number }).groupId -
        (right as { groupId: number }).groupId,
    })
    for (const row of [...rows].reverse())
      index.add(row.key, { value: row.value })
    expectCustomGroups(index, rows, identities)
    const wrongOutput = vi
      .spyOn(index, `takeFromStart`)
      .mockReturnValue([`1`, `0`, `2`])
    try {
      expect(() => expectCustomGroups(index, rows, identities)).toThrowError(
        /expected/,
      )
    } finally {
      wrongOutput.mockRestore()
    }
    // The driver-visible objects can change without rewriting the authority.
    for (const row of rows) row.value.groupId = 0
    index.build(rows.map((row) => [row.key, { value: row.value }]))
    expect(rows.map((row) => row.groupId)).toEqual([1, 1, 2])
    // Re-reading payload fields as facts reproduces the old false green.
    const driftedAuthority = rows.map((row) => ({
      ...row,
      groupId: row.value.groupId,
    }))
    expectCustomGroups(index, driftedAuthority, identities)
    expect(() => expectCustomGroups(index, rows, identities)).toThrowError(
      /expected/,
    )
    for (const row of rows) row.value.groupId = row.groupId
    index.build(rows.map((row) => [row.key, { value: row.value }]))
    expectCustomGroups(index, rows, identities)
  })

  test(`moves exact string membership across a comparator-equal update`, () => {
    // The input facts put A/a in one order group and B/b in another. The
    // comparator implements that order, but the expected exact memberships
    // come from the source Map's unchanged strings, not from the comparator.
    const group = { A: 0, a: 0, B: 1, b: 1 } as const
    type Value = keyof typeof group
    const rows = new Map<string, Value>()
    const index = new IndexType(1, new PropRef([`value`]), undefined, {
      compareFn: (left, right) =>
        (left as string)
          .toLowerCase()
          .localeCompare((right as string).toLowerCase()),
    })
    const expectMatchesSource = () =>
      expectStringMembershipMatches(index, rows, group)

    // Check after each direct index action. First update a singleton, as in
    // the legacy witness; then add peers in both comparator groups. A shortcut
    // limited to singleton indexes must fail before the peers can mask it.
    index.add(`changed`, { value: `A` })
    rows.set(`changed`, `A`)
    expectMatchesSource()

    const skipEqualUpdate = vi.spyOn(index, `update`).mockImplementation(() => {
      if (index.keyCount === 1) return
    })
    try {
      index.update(`changed`, { value: `A` }, { value: `a` })
      rows.set(`changed`, `a`)
      expect(() => expectMatchesSource()).toThrowError(/expected/)
    } finally {
      skipEqualUpdate.mockRestore()
      rows.set(`changed`, `A`)
    }

    for (const [key, oldValue, newValue] of [
      [`changed`, `A`, `a`],
      [`changed`, `a`, `A`],
    ] as Array<[string, Value, Value]>) {
      index.update(key, { value: oldValue }, { value: newValue })
      rows.set(key, newValue)
      expectMatchesSource()
    }

    index.add(`anchor`, { value: `a` })
    rows.set(`anchor`, `a`)
    expectMatchesSource()
    index.add(`other`, { value: `B` })
    rows.set(`other`, `B`)
    expectMatchesSource()

    // These histories additionally retain another exact value in the same
    // order group and then move a key across groups.
    for (const [key, oldValue, newValue] of [
      [`changed`, `A`, `a`],
      [`other`, `B`, `b`],
      [`other`, `b`, `a`],
    ] as Array<[string, Value, Value]>) {
      index.update(key, { value: oldValue }, { value: newValue })
      rows.set(key, newValue)
      expectMatchesSource()
    }

    // EqualityLookup and the public lookup dispatch are separate methods.
    // A dispatch that substitutes the comparator group for exact equality
    // would pass an equalityLookup-only check after the same-group update.
    const lookup = index.lookup.bind(index)
    const wrongLookup = vi
      .spyOn(index, `lookup`)
      .mockImplementation((operation, value) =>
        operation === `eq`
          ? index.rangeQuery({ from: value, to: value })
          : lookup(operation, value),
      )
    try {
      expect(() => expectMatchesSource()).toThrowError(/expected/)
    } finally {
      wrongLookup.mockRestore()
    }
  })

  // Group grammar: 2..20 generated IDs in 0..4, with a forced duplicate first
  // group and a distinct group 5. The same bounded input is run in both index
  // types. The exact-identity lane gives every row a fresh array, then retires
  // and reuses handles. The custom-comparator lane additionally reverses
  // insertion. Without the duplicate, representative retirement is absent;
  // without the distinct group, group order is unobservable; without reversed
  // insertion, insertion order can masquerade as lexical key order. Replacing
  // one value with a fresh value in the same group checks exact membership
  // independently of comparator position; a later update crosses groups.
  // The pinned [0, 1] case reconstructs these distinctions. Invalid comparator
  // results and inconsistent comparator order are outside these two grammars.
  test.each([20260930, undefined])(
    `preserves exact equality while ordered traversal retains every row (seed %s)`,
    async (seed) => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.integer({ min: 0, max: 4 }), {
            minLength: 2,
            maxLength: 20,
          }),
          async (groupIds) => {
            // The first representative must retire while its group survives. Group
            // 5 is distinct from every generated group even after shrinking. Fresh
            // arrays distinguish exact identity from comparator-equal numeric values.
            const rows = [
              groupIds[0]!,
              groupIds[0]!,
              5,
              ...groupIds.slice(1),
            ].map((groupId, position) => ({
              key: String(position),
              value: [groupId],
              groupId,
            }))
            const identities = rows.map((row) => row.value)
            const index = new IndexType(1, new PropRef([`value`]))

            const expectMatchesModel = (
              subject: BaseIndex<string>,
              currentRows: typeof rows,
            ) => {
              const groups = new Map<number, typeof rows>()
              for (const row of currentRows) {
                const group = groups.get(row.groupId) ?? []
                group.push(row)
                groups.set(row.groupId, group)
              }
              const orderedGroups = [...groups.values()].sort(
                (left, right) => left[0]!.groupId - right[0]!.groupId,
              )
              const forward = orderedGroups.flatMap((group) =>
                group.map((row) => row.key).sort(),
              )
              const reversed = [...orderedGroups].reverse().flatMap((group) =>
                group
                  .map((row) => row.key)
                  .sort()
                  .reverse(),
              )

              expect(subject.keyCount).toBe(currentRows.length)
              expectExactIdentities(subject, currentRows, identities)
              expect(subject.takeFromStart(currentRows.length + 1)).toEqual(
                forward,
              )
              expect(
                subject.takeReversedFromEnd(currentRows.length + 1),
              ).toEqual(reversed)
              for (const row of currentRows) {
                expect(subject.equalityLookup(row.value)).toEqual(
                  new Set([row.key]),
                )
                expect(
                  subject.rangeQuery({ from: row.value, to: row.value }),
                ).toEqual(
                  new Set(
                    currentRows
                      .filter((candidate) => candidate.groupId === row.groupId)
                      .map((candidate) => candidate.key),
                  ),
                )
              }
            }

            expectMatchesModel(index, [])
            for (const row of rows) index.add(row.key, { value: row.value })
            expectMatchesModel(index, rows)

            const removed = rows.shift()!
            expect(rows.some((row) => row.groupId === removed.groupId)).toBe(
              true,
            )
            index.remove(removed.key, removed)
            expectMatchesModel(index, rows)

            const changed = rows[0]!
            const previous = { ...changed }
            changed.groupId = 99
            changed.value = [99]
            identities.push(changed.value)
            index.update(changed.key, previous, changed)
            expectMatchesModel(index, rows)

            // Reuse both a removed identity and an identity retired by update.
            for (const retired of [removed, previous]) {
              const reused = { ...retired, key: `reused-${retired.key}` }
              index.add(reused.key, { value: reused.value })
              rows.push(reused)
              expectMatchesModel(index, rows)
            }

            const rebuilt = new IndexType(2, new PropRef([`value`]))
            rebuilt.build(rows.map((row) => [row.key, row]))
            expectMatchesModel(rebuilt, rows)

            const replacement = {
              key: `replacement`,
              groupId: 100,
              value: [100],
            }
            identities.push(replacement.value)
            index.build([[replacement.key, { value: replacement.value }]])
            expectMatchesModel(index, [replacement])
            index.update(replacement.key, replacement, removed)
            const resumed = { ...removed, key: replacement.key }
            expectMatchesModel(index, [resumed])
            index.remove(resumed.key, resumed)
            expectMatchesModel(index, [])
            index.add(removed.key, removed)
            expectMatchesModel(index, [removed])
            index.build([])
            expectMatchesModel(index, [])
            index.add(previous.key, previous)
            expectMatchesModel(index, [previous])
          },
        ),
        {
          ...(seed === undefined
            ? oraclePropertyOptions(100, `index-update.exact-identity`)
            : { seed, numRuns: oracleRuns(100) }),
          examples: [[[0, 1]]],
        },
      )
    },
  )

  test.each([20260930, undefined])(
    `matches an independent custom-comparator model (seed %s)`,
    async (seed) => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.integer({ min: 0, max: 4 }), {
            minLength: 2,
            maxLength: 20,
          }),
          async (generatedGroups) => {
            for (const reverseInsertion of [false, true]) {
              const groupIds = [
                generatedGroups[0]!,
                generatedGroups[0]!,
                5,
                ...generatedGroups.slice(1),
              ]
              const rows = groupIds.map((groupId, position) =>
                Object.freeze({
                  key: String(position).padStart(2, `0`),
                  value: { groupId, position },
                  groupId,
                }),
              )
              const identities = rows.map((row) => row.value)
              const index = new IndexType(
                1,
                new PropRef([`value`]),
                undefined,
                {
                  compareFn: (left, right) =>
                    (left as { groupId: number }).groupId -
                    (right as { groupId: number }).groupId,
                },
              )

              expectCustomGroups(index, [], identities)
              // Preserve forward insertion and challenge it with a real permutation:
              // key 01 precedes 00 in the reverse run, but expected order stays lexical.
              for (const row of reverseInsertion ? [...rows].reverse() : rows)
                index.add(row.key, { value: row.value })
              expectCustomGroups(index, rows, identities)

              const removed = rows.shift()!
              expect(rows.some((row) => row.groupId === removed.groupId)).toBe(
                true,
              )
              index.remove(removed.key, { value: removed.value })
              expectCustomGroups(index, rows, identities)

              const previous = rows[0]!
              const equalGroup = Object.freeze({
                key: previous.key,
                groupId: previous.groupId,
                value: {
                  groupId: previous.groupId,
                  position: previous.value.position,
                },
              })
              identities.push(equalGroup.value)
              index.update(
                previous.key,
                { value: previous.value },
                { value: equalGroup.value },
              )
              rows[0] = equalGroup
              expectCustomGroups(index, rows, identities)

              const changed = Object.freeze({
                key: previous.key,
                groupId: 99,
                value: { groupId: 99, position: previous.value.position },
              })
              identities.push(changed.value)
              index.update(
                previous.key,
                { value: equalGroup.value },
                { value: changed.value },
              )
              rows[0] = changed
              expectCustomGroups(index, rows, identities)

              for (const [ordinal, retired] of [
                removed,
                previous,
                equalGroup,
              ].entries()) {
                const reused = Object.freeze({
                  ...retired,
                  key: `reused-${ordinal}-${retired.key}`,
                })
                index.add(reused.key, { value: reused.value })
                rows.push(reused)
                expectCustomGroups(index, rows, identities)
              }

              index.build([[changed.key, { value: changed.value }]])
              expectCustomGroups(index, [changed], identities)
              index.update(
                changed.key,
                { value: changed.value },
                { value: removed.value },
              )
              const resumed = Object.freeze({ ...removed, key: changed.key })
              expectCustomGroups(index, [resumed], identities)
              index.remove(resumed.key, { value: resumed.value })
              expectCustomGroups(index, [], identities)
              index.add(removed.key, { value: removed.value })
              expectCustomGroups(index, [removed], identities)
              index.build([])
              expectCustomGroups(index, [], identities)
              index.add(previous.key, { value: previous.value })
              expectCustomGroups(index, [previous], identities)
            }
          },
        ),
        {
          ...(seed === undefined
            ? oraclePropertyOptions(100, `index-update.custom-comparator`)
            : { seed, numRuns: oracleRuns(100) }),
          examples: [[[0, 1]]],
        },
      )
    },
  )
})

test(`retired-identity calibration shrinks and replays the same semantic failure`, () => {
  const property = fc.property(
    fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 8 }),
    (keys) => {
      const identity = {}
      expectExactIdentities(
        { equalityLookup: () => new Set(keys.map(String)) },
        [],
        [identity],
      )
    },
  )
  const failed = fc.check(property, { seed: 303108, numRuns: 1 })
  expect(failed.failed).toBe(true)
  expect(failed.error).toMatch(/expected/)
  expect(failed.counterexample).toEqual([[0]])
  expect(failed.counterexamplePath).toBe(`0:0:0`)
  if (failed.counterexamplePath === null)
    throw new Error(`Missing calibration replay path`)
  const replay = fc.check(property, {
    seed: failed.seed,
    path: failed.counterexamplePath,
    numRuns: 1,
    endOnFailure: true,
  })
  expect(replay.failed).toBe(true)
  expect(replay.error).toMatch(/expected/)
  expect(replay.counterexample).toEqual(failed.counterexample)
})

/**
 * Mixed primitive values can share a comparator position without sharing an
 * exact value. The source Map owns each key once. This model intentionally
 * predicts membership and multiplicity, not the relative order of a number
 * and a string. Its fixed grammar adds 2, "2", and "10", then removes each
 * possible owner in a fresh history. A second history deletes, updates across
 * value kinds, then re-adds an earlier key. A third history adds two ordered
 * Temporal values beside an ordinary string that resembles an internal key,
 * then deletes one Temporal owner. After each returned action, both full index
 * traversals must contain exactly the live source keys.
 *
 * In the public lane a ready Collection receives the same rows and deletes
 * the number. A manual index serves a bounded `currentStateAsChanges` read
 * with room for one more row than the source contains. The returned change
 * messages must contain each live key once. `optimizedOnly` and the take spy
 * establish that this observation came through the index. No mixed-kind
 * `orderBy` sequence, custom callback, or modified built-in is claimed.
 */
const mixedRows: ReadonlyArray<{ id: string; value: number | string }> = [
  { id: `a`, value: 2 },
  { id: `b`, value: `2` },
  { id: `c`, value: `10` },
]

function expectConservedIndexKeys(
  index: BaseIndex<string>,
  rows: ReadonlyMap<string, unknown>,
): void {
  const expected = new Set(rows.keys())
  expect(index.keyCount).toBe(expected.size)
  for (const keys of [
    index.takeFromStart(rows.size + 1),
    index.takeReversedFromEnd(rows.size + 1),
  ]) {
    expect(keys).toHaveLength(expected.size)
    expect(new Set(keys)).toEqual(expected)
  }
}

describe.each(indexTypes)(
  `%s mixed-value key conservation`,
  (_indexName, IndexType) => {
    test.each(mixedRows)(
      `keeps every surviving key once after deleting $id`,
      (removed) => {
        const index = new IndexType(1, new PropRef([`value`]))
        const rows = new Map<string, number | string>()
        for (const row of mixedRows) {
          index.add(row.id, row)
          rows.set(row.id, row.value)
          expectConservedIndexKeys(index, rows)
        }
        index.remove(removed.id, removed)
        rows.delete(removed.id)
        expectConservedIndexKeys(index, rows)
      },
    )

    test(`keeps one copy of each key after a mixed-value delete, update, and add`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, number | string>()
      const add = (id: string, value: number | string) => {
        index.add(id, { id, value })
        rows.set(id, value)
        expectConservedIndexKeys(index, rows)
      }

      add(`a`, 2)
      add(`b`, `2`)
      add(`d`, `10`)
      index.remove(`a`, { id: `a`, value: 2 })
      rows.delete(`a`)
      expectConservedIndexKeys(index, rows)
      index.update(`b`, { id: `b`, value: `2` }, { id: `b`, value: 2 })
      rows.set(`b`, 2)
      expectConservedIndexKeys(index, rows)
      add(`a`, `2`)
    })

    test.each([
      {
        name: `ZonedDateTime`,
        first:
          Temporal.Instant.fromEpochNanoseconds(9n).toZonedDateTimeISO(`UTC`),
        second:
          Temporal.Instant.fromEpochNanoseconds(10n).toZonedDateTimeISO(`UTC`),
        text: `tanstack-db:temporal:Temporal.ZonedDateTime:5:fake`,
      },
      {
        name: `Duration`,
        first: Temporal.Duration.from({ nanoseconds: 9 }),
        second: Temporal.Duration.from({ nanoseconds: 10 }),
        text: `tanstack-db:temporal:Temporal.Duration:time:5:fake`,
      },
    ])(
      `keeps $name and ordinary-string owners after deletion`,
      ({ first, second, text }) => {
        const index = new IndexType(1, new PropRef([`value`]))
        const rows = new Map<string, unknown>()
        for (const [id, value] of [
          [`a`, first],
          [`b`, second],
          [`c`, text],
        ] as const) {
          index.add(id, { id, value })
          rows.set(id, value)
          expectConservedIndexKeys(index, rows)
        }
        index.remove(`b`, { id: `b`, value: second })
        rows.delete(`b`)
        expectConservedIndexKeys(index, rows)
      },
    )
  },
)

describe.each([
  [`BasicIndex`, BasicIndex],
  [`BTreeIndex`, BTreeIndex],
] as const)(`%s mixed-value public snapshot`, (_indexName, IndexType) => {
  test(`returns each surviving key once after a source deletion`, async () => {
    const options = mockSyncCollectionOptions<{
      id: string
      value: number | string
    }>({
      id: `mixed-value-public-snapshot-${IndexType.name}`,
      getKey: (row) => row.id,
      initialData: mixedRows.map((row) => ({ ...row })),
      autoIndex: `off`,
    })
    const collection = createCollection(options)
    await withCollectionCleanup(collection, async () => {
      await collection.stateWhenReady()
      const index = collection.createIndex((row) => row.value, {
        indexType: IndexType,
      })
      const take = vi.spyOn(index, `takeFromStart`)
      const rows = new Map(mixedRows.map((row) => [row.id, row.value]))

      options.utils.begin()
      options.utils.write({ type: `delete`, value: mixedRows[0]! })
      options.utils.commit()
      rows.delete(mixedRows[0]!.id)

      take.mockClear()

      const changes = collection.currentStateAsChanges({
        orderBy: [
          {
            expression: new PropRef([`value`]),
            compareOptions: { direction: `asc`, nulls: `first` },
          },
        ],
        limit: rows.size + 1,
        optimizedOnly: true,
      })
      expect(take).toHaveBeenCalled()
      expect(changes).toBeDefined()
      expectSnapshotKeysMatchSource(
        changes!.map((change) => change.key),
        rows,
      )
    })
  })
})

/**
 * Public snapshot law after a source deletion: a complete bounded read returns
 * each surviving source key exactly once. The source Map is the model.
 */
function expectSnapshotKeysMatchSource(
  keys: ReadonlyArray<unknown>,
  rows: ReadonlyMap<string, unknown>,
): void {
  expect(keys).toHaveLength(rows.size)
  expect(new Set(keys)).toEqual(new Set(rows.keys()))
}

/**
 * Binary ownership law: exact membership and both complete index reads agree
 * with the source Map after each action. Byte order is not part of the law.
 */
function expectBinaryValueMembership(
  index: BaseIndex<string>,
  rows: ReadonlyMap<string, Uint8Array>,
  bytes: (value?: number) => Uint8Array,
): void {
  const expected = new Set(rows.keys())
  expect(index.keyCount).toBe(rows.size)
  expect(index.equalityLookup(bytes())).toEqual(
    new Set(
      [...rows].filter(([, value]) => value[0] === 1).map(([key]) => key),
    ),
  )
  for (const read of [
    index.takeFromStart(rows.size + 1),
    index.takeReversedFromEnd(rows.size + 1),
  ]) {
    expect(read).toHaveLength(rows.size)
    expect(new Set(read)).toEqual(expected)
  }
}

describe.each(indexTypes)(`%s binary-value ownership`, (_name, IndexType) => {
  test(`does not retain an ordered entry after equal-content removal`, () => {
    const index = new IndexType(1, new PropRef([`value`]))
    const rows = new Map<string, Uint8Array>()
    const bytes = (value = 1) => new Uint8Array([value])
    const check = () => expectBinaryValueMembership(index, rows, bytes)

    index.add(`a`, { value: bytes() })
    rows.set(`a`, bytes())
    check()
    index.remove(`a`, { value: bytes() })
    rows.delete(`a`)
    check()
    index.add(`b`, { value: bytes() })
    rows.set(`b`, bytes())
    check()

    const oldBytes = bytes()
    index.add(`c`, { value: bytes(2) })
    rows.set(`c`, bytes(2))
    index.add(`d`, { value: oldBytes })
    rows.set(`d`, oldBytes)
    check()
    index.remove(`b`, { value: bytes() })
    rows.delete(`b`)
    check()
    index.update(`d`, { value: oldBytes }, { value: bytes() })
    rows.set(`d`, bytes())
    check()
  })
})

/**
 * Model for PlainMonthDay equality: the keys whose source value has the same
 * month code and day as the probe. It reads the source rows, not the index.
 */
function predictMonthDayOwners(
  rows: ReadonlyArray<{ id: string; value: Temporal.PlainMonthDay }>,
  probe: Temporal.PlainMonthDay,
): Set<string> {
  return new Set(
    rows
      .filter(
        (row) =>
          row.value.monthCode === probe.monthCode &&
          row.value.day === probe.day,
      )
      .map((row) => row.id),
  )
}

/**
 * PlainMonthDay has exact equality but no intrinsic order. The two-row source
 * Map predicts one key for a copy of February 1, both before and after index
 * creation. The index may choose any storage order; a public equality read
 * must not fail merely because both values are present.
 */
describe.each(indexTypes)(
  `%s unordered Temporal equality`,
  (_name, IndexType) => {
    test(`accepts distinct PlainMonthDay values for exact lookup`, async () => {
      const rows = [
        { id: `jan`, value: Temporal.PlainMonthDay.from(`--01-01`) },
        { id: `feb`, value: Temporal.PlainMonthDay.from(`--02-01`) },
      ]
      const probe = Temporal.PlainMonthDay.from(`--02-01`)
      const expected = predictMonthDayOwners(rows, probe)
      const index = new IndexType(1, new PropRef([`value`]))
      for (const row of rows) index.add(row.id, row)
      expect(index.lookup(`eq`, probe)).toEqual(expected)

      const collection = createCollection(
        mockSyncCollectionOptions({
          id: `month-day-equality-${IndexType.name}`,
          getKey: (row: (typeof rows)[number]) => row.id,
          initialData: rows,
          autoIndex: `off`,
          defaultIndexType: IndexType,
        }),
      )
      await withCollectionCleanup(collection, async () => {
        await collection.stateWhenReady()
        const where = eq(new PropRef([`value`]), probe)
        const read = () =>
          collection
            .currentStateAsChanges({ where })!
            .map((row) => row.key)
            .sort()
        expect(read()).toEqual([...expected].sort())
        const publicIndex = collection.createIndex((row) => row.value)
        const lookup = vi.spyOn(publicIndex, `lookup`)
        expect(read()).toEqual([...expected].sort())
        expect(lookup).toHaveBeenCalled()
      })
    })
  },
)
