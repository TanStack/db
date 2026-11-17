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
import { expect, vi } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { createCollection } from '../src/collection/index.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { eq } from '../src/query/builder/functions.js'
import { PropRef } from '../src/query/ir.js'
import { mockSyncCollectionOptions } from './utils.js'
import { oracleProperty } from './oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter.js'
import {
  cases,
  modelEqual,
  modelKeys,
} from './duration-query-equality-model-oracle.js'

// The check: a public or direct read returns exactly the model's key set,
// in the same representation, at the read that was made.
function expectExactKeys(
  actual: unknown,
  expected: ReadonlySet<string> | ReadonlyArray<string>,
  label: string,
): void {
  expect(actual, label).toEqual(expected)
}

const indexTypes = [
  [`BasicIndex`, BasicIndex],
  [`BTreeIndex`, BTreeIndex],
] as const
type IndexName = (typeof indexTypes)[number][0]
const indexNames = indexTypes.map(([name]) => name)
const indexType = (name: IndexName) =>
  indexTypes.find(([candidate]) => candidate === name)![1]

const durationLaw = {
  statement: `Query equality and exact index lookup on Temporal.Duration preserve each of its ten public fields, before and after indexing.`,
  authority: `Changelog #1519: equivalent Duration forms stay unequal under eq; the ten-field model stated above`,
  limits: `The fixed one-row field, same-display, sign and second-field probes and the two-row calendar history, through BasicIndex and BTreeIndex; no ordering, other Temporal kinds, mutations or live publication.`,
}

function runDirectLookup(IndexType: typeof BasicIndex | typeof BTreeIndex) {
  for (const { name, stored, probe } of cases) {
    const index = new IndexType(1, new PropRef([`value`]))
    index.add(`row`, { value: stored })
    expectExactKeys(
      index.lookup(`eq`, probe),
      modelKeys({ name, stored, probe }),
      name,
    )
  }
}

// What this oracle owns: the exact-key lookups of BasicIndex and BTreeIndex,
// which the public eq read reaches, by this file's Duration cases.
oracleProperty({
  id: `duration-query-equality.direct-lookup`,
  law: durationLaw,
  owns: [
    `src/indexes/basic-index.ts#BasicIndex.lookup`,
    `src/indexes/btree-index.ts#BTreeIndex.lookup`,
  ],
  histories: indexNames,
  label: (name) => `${name} exact lookup follows Duration fields`,
  resolve: (name) => ({ name }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `duration-query-equality.direct-lookup`,
      plan,
      observe,
      () => runDirectLookup(indexType(plan.name)),
    ),
  check: forwardAssertionJudgment,
})

async function runPublicEq(IndexType: typeof BasicIndex | typeof BTreeIndex) {
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
      expectExactKeys(readKeys(), expected, `${name}: scan`)
      const index = source.createIndex((row) => row.value)
      const lookup = vi.spyOn(index, `lookup`)
      expectExactKeys(readKeys(), expected, `${name}: indexed`)
      expect(lookup, `${name}: index path`).toHaveBeenCalled()
    } finally {
      await source.cleanup()
    }
  }
}

oracleProperty({
  id: `duration-query-equality.public-eq`,
  law: durationLaw,
  owns: [
    `src/indexes/basic-index.ts#BasicIndex.lookup`,
    `src/indexes/btree-index.ts#BTreeIndex.lookup`,
  ],
  histories: indexNames,
  label: (name) => `public eq agrees before and after ${name} indexing`,
  resolve: (name) => ({ name }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `duration-query-equality.public-eq`,
      plan,
      observe,
      () => runPublicEq(indexType(plan.name)),
    ),
  check: forwardAssertionJudgment,
})

// The model distinguishes year counts by their public fields. Both rows are
// legal equality inputs even though comparing their duration requires a
// relative date. The scan, direct index, and indexed Collection read observe
// exact key sets; this test makes no claim about their relative order.
async function runCalendarIndexing(
  IndexType: typeof BasicIndex | typeof BTreeIndex,
) {
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
}

oracleProperty({
  id: `duration-query-equality.calendar-indexing`,
  law: durationLaw,
  owns: [
    `src/indexes/basic-index.ts#BasicIndex.lookup`,
    `src/indexes/btree-index.ts#BTreeIndex.lookup`,
  ],
  histories: indexNames,
  label: (name) =>
    `${name} preserves equality indexing for multiple calendar Durations`,
  resolve: (name) => ({ name }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `duration-query-equality.calendar-indexing`,
      plan,
      observe,
      () => runCalendarIndexing(indexType(plan.name)),
    ),
  check: forwardAssertionJudgment,
})
