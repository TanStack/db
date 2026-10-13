/**
 * Query equality preserves each of a Temporal.Duration's ten fields. Changelog
 * #1519 explicitly keeps equivalent Duration forms unequal under `eq`: one
 * second and 1000 milliseconds display alike but have different fields.
 *
 * The independent model reads the ten public fields rather than formatting a
 * Duration or importing query normalization. The fixed input grammar inserts
 * one ordinary Duration row, then probes an equal copy and a changed value
 * for every field. A two-row calendar-unit history checks that equality
 * indexing remains available when Duration has no intrinsic order without
 * `relativeTo`. Three further probes distinguish a same-display unit change,
 * opposite signs, and a changed second nonzero field.
 * Each direct BasicIndex/BTreeIndex exact lookup and each public Collection
 * `eq` read before and after indexing must return the model's exact key set at
 * that read. An index spy confirms the indexed public route ran. These checks
 * make no claim about Duration ordering, other Temporal kinds, mutations, or
 * live subscriber publication.
 */
import { expect, it, vi } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { createCollection } from '../src/collection/index.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { eq } from '../src/query/builder/functions.js'
import { PropRef } from '../src/query/ir.js'
import { mockSyncCollectionOptions } from './utils.js'

const fields = [
  `years`,
  `months`,
  `weeks`,
  `days`,
  `hours`,
  `minutes`,
  `seconds`,
  `milliseconds`,
  `microseconds`,
  `nanoseconds`,
] as const

function modelEqual(
  left: Temporal.Duration,
  right: Temporal.Duration,
): boolean {
  return fields.every((field) => left[field] === right[field])
}

type Case = {
  name: string
  stored: Temporal.Duration
  probe: Temporal.Duration
}

const sameDisplay: Case = {
  name: `seconds versus milliseconds with identical display`,
  stored: Temporal.Duration.from({ seconds: 1 }),
  probe: Temporal.Duration.from({ milliseconds: 1000 }),
}
const oppositeSigns: Case = {
  name: `opposite signs`,
  stored: Temporal.Duration.from({ seconds: 1 }),
  probe: Temporal.Duration.from({ seconds: -1 }),
}
const secondFieldChange: Case = {
  name: `same first nonzero field with a changed second field`,
  stored: Temporal.Duration.from({ hours: 1, minutes: 2 }),
  probe: Temporal.Duration.from({ hours: 1, minutes: 3 }),
}

const cases: ReadonlyArray<Case> = [
  ...fields.flatMap((field) => {
    const stored = Temporal.Duration.from({ [field]: 1 })
    return [
      {
        name: `${field} equal copy`,
        stored,
        probe: Temporal.Duration.from({ [field]: 1 }),
      },
      {
        name: `${field} changed`,
        stored,
        probe: Temporal.Duration.from({ [field]: 2 }),
      },
    ]
  }),
  sameDisplay,
  oppositeSigns,
  secondFieldChange,
]

function modelKeys({ stored, probe }: Case): Set<string> {
  return new Set(modelEqual(stored, probe) ? [`row`] : [])
}

const indexTypes = [
  [`BasicIndex`, BasicIndex],
  [`BTreeIndex`, BTreeIndex],
] as const

// Every field changes the model's answer, while a separately constructed
// equal copy does not. Three pairs kill text, absolute-value, and first-field
// key mutants at the same exact-key-set comparison used below.
it(`calibrates all ten fields and three plausible wrong keys`, () => {
  for (const [equal, changed] of Array.from({ length: 10 }, (_, index) =>
    cases.slice(index * 2, index * 2 + 2),
  )) {
    expect(modelEqual(equal!.stored, equal!.probe)).toBe(true)
    expect(modelEqual(changed!.stored, changed!.probe)).toBe(false)
  }
  expect(String(sameDisplay.stored)).toBe(String(sameDisplay.probe))
  expect(modelEqual(sameDisplay.stored, sameDisplay.probe)).toBe(false)
  const magnitudeKey = (value: Temporal.Duration) =>
    fields.map((field) => Math.abs(value[field])).join(`,`)
  const firstNonzeroKey = (value: Temporal.Duration) => {
    const field = fields.find((candidate) => value[candidate] !== 0)!
    return `${field}:${value[field]}`
  }
  const wrongKeys = (
    testCase: Case,
    key: (value: Temporal.Duration) => string,
  ) => new Set(key(testCase.stored) === key(testCase.probe) ? [`row`] : [])
  for (const [testCase, key] of [
    [sameDisplay, String],
    [oppositeSigns, magnitudeKey],
    [secondFieldChange, firstNonzeroKey],
  ] as const) {
    expect(() =>
      expect(wrongKeys(testCase, key)).toEqual(modelKeys(testCase)),
    ).toThrow()
  }
})

it.each(indexTypes)(
  `%s exact lookup follows Duration fields`,
  (_name, IndexType) => {
    for (const { name, stored, probe } of cases) {
      const index = new IndexType(1, new PropRef([`value`]))
      index.add(`row`, { value: stored })
      expect(index.lookup(`eq`, probe), name).toEqual(
        modelKeys({ name, stored, probe }),
      )
    }
  },
)

it.each(indexTypes)(
  `public eq agrees before and after %s indexing`,
  async (_name, IndexType) => {
    for (const { name, stored, probe } of cases) {
      const source = createCollection(
        mockSyncCollectionOptions({
          id: `duration-query-equality-${name}`,
          getKey: (row: { id: string; value: Temporal.Duration }) => row.id,
          initialData: [{ id: `row`, value: stored }],
          autoIndex: `off`,
          defaultIndexType: IndexType,
        }),
      )
      try {
        await source.stateWhenReady()
        const where = eq(new PropRef([`value`]), probe)
        const expected = [...modelKeys({ name, stored, probe })]
        const readKeys = () =>
          source.currentStateAsChanges({ where })!.map((change) => change.key)
        expect(readKeys(), `${name}: scan`).toEqual(expected)
        const index = source.createIndex((row) => row.value)
        const lookup = vi.spyOn(index, `lookup`)
        expect(readKeys(), `${name}: indexed`).toEqual(expected)
        expect(lookup, `${name}: index path`).toHaveBeenCalled()
      } finally {
        await source.cleanup()
      }
    }
  },
)

// The model distinguishes year counts by their public fields. Both rows are
// legal equality inputs even though comparing their duration requires a
// relative date. The scan, direct index, and indexed Collection read observe
// exact key sets; this test makes no claim about their relative order.
it.each(indexTypes)(
  `%s preserves equality indexing for multiple calendar Durations`,
  async (_name, IndexType) => {
    const rows = [
      { id: `one`, value: Temporal.Duration.from({ years: 1 }) },
      { id: `two`, value: Temporal.Duration.from({ years: 2 }) },
    ]
    const probe = Temporal.Duration.from({ years: 2 })
    const expected = new Set(
      rows.filter((row) => modelEqual(row.value, probe)).map((row) => row.id),
    )
    const index = new IndexType(1, new PropRef([`value`]))
    for (const row of rows) index.add(row.id, row)
    expect(index.lookup(`eq`, probe)).toEqual(expected)

    const source = createCollection(
      mockSyncCollectionOptions({
        id: `calendar-duration-equality-${IndexType.name}`,
        getKey: (row: (typeof rows)[number]) => row.id,
        initialData: rows,
        autoIndex: `off`,
        defaultIndexType: IndexType,
      }),
    )
    try {
      await source.stateWhenReady()
      const where = eq(new PropRef([`value`]), probe)
      const read = () =>
        new Set(source.currentStateAsChanges({ where })!.map((row) => row.key))
      expect(read()).toEqual(expected)
      const publicIndex = source.createIndex((row) => row.value)
      const lookup = vi.spyOn(publicIndex, `lookup`)
      expect(read()).toEqual(expected)
      expect(lookup).toHaveBeenCalled()
    } finally {
      await source.cleanup()
    }
  },
)
