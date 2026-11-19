// @vitest-environment node
/**
 * Can accepted typed values survive a SQLite close/reopen without losing meaning?
 *
 * Authority: the existing core adapter contract preserves Date and BigInt.
 * Issue https://github.com/TanStack/db/issues/2034 requests the same behavior for
 * Temporal.Instant and Temporal.PlainDate. The approved v2 design requires
 * native reconstruction with registered global constructors. Missing support
 * rejects explicitly; new marker-shaped records remain ordinary data.
 *
 * Model: two independent fixture ordinals mean earlier/later. Expected values
 * are literal type/text records, and expected query keys follow those ordinals.
 * No production encoder, decoder, SQL compiler, or comparator supplies truth.
 * Type/text records are model-only observations, not a proposed storage format.
 *
 * Bounded grammar: Date, ISO string, Instant, and PlainDate; insert then optional
 * update that swaps the two values; with/without an installed expression index.
 * Every write carries direct/nested row values, inline row metadata, separate
 * row metadata, and collection metadata. The update swaps value order while
 * retaining keys, exposing collapsed-value ties. All 16 cells run; no random campaign.
 * Removing kind loses Temporal reach or passing controls; removing update loses
 * replacement/replay coverage; removing index loses that query configuration.
 * Fresh unique keys and monotonic transaction positions exclude invalid writes.
 *
 * Driver/checkpoint: real SQLiteCorePersistenceAdapter over file-backed
 * node:sqlite. After committed writes, close the handle, create a new handle
 * and adapter, and observe loadSubset, scanRows, loadCollectionMetadata, and
 * pullSince. Queries check equality, range, and both positions of an ordered
 * one-row window. Installed indexes have a sqlite_master reach witness; this
 * oracle does not claim the query planner uses them.
 *
 * Limits: one polyfill copy and in-process reopen. The companion rank/text
 * model below adds precision, supported-range endpoints, signed years and
 * calendar annotations. Other Temporal kinds, engine-native constructors,
 * truncate/delete histories, crashes and mobile/browser hosts remain outside
 * this owner. The Node expression-index owner separately observes raw SQL and
 * actual index use with these values.
 *
 * Calibration: the same comparison rejects empty objects, ISO-string erasure,
 * wrong same-type values, missing/duplicate rows, and reversed query output.
 * Those calibrations run no production, so they live in
 * sqlite-temporal-value-calibration.test.ts; the model and grammar live in
 * sqlite-temporal-value-model-oracle.ts. afterEach owns handles/files; Vitest retains assertion and teardown failures
 * separately. The review record documents ORC outcomes and exact run receipts:
 * docs/contributing/oracle-reviews/issue-2034-temporal-persistence.md.
 */
import { IR } from '@tanstack/db'
import { Temporal } from 'temporal-polyfill'
import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import {
  temporalFamilies,
  temporalQueryCases,
  temporalValue,
} from './temporal-value-oracle'
import { check, collectionId, scope } from './sqlite-temporal-value-support'
import {
  cases,
  expectedRows,
  expectedValue,
  inputValue,
  keys,
  payload,
} from './sqlite-temporal-value-model-oracle'
import type { TemporalFamily } from './temporal-value-oracle'
import type {
  History,
  Kind,
  Ordinal,
} from './sqlite-temporal-value-model-oracle'
import type { PersistedTx } from '../src'

beforeEach(() => vi.stubGlobal(`Temporal`, Temporal))
afterEach(() => vi.unstubAllGlobals())
afterEach(scope.cleanup)

function transaction(kind: Kind, history: History): PersistedTx {
  const seq = history === `insert` ? 2 : 3
  const ordinals: Array<Ordinal> = history === `insert` ? [0, 1] : [1, 0]
  return {
    txId: `values-${seq}`,
    term: 1,
    seq,
    rowVersion: seq,
    mutations: keys.map((key, index) => ({
      type: history,
      key,
      value: { id: key, ...payload(inputValue(kind, ordinals[index]!)) },
      metadata: payload(inputValue(kind, ordinals[index]!)),
      metadataChanged: true,
    })),
    // A separate key retains the independent row-metadata mutation path.
    rowMetadataMutations: [
      {
        type: `set`,
        key: `metadata-only`,
        value: payload(inputValue(kind, 1)),
      },
    ],
    collectionMetadataMutations: [
      {
        type: `set`,
        key: `checkpoint`,
        value: payload(inputValue(kind, 0)),
      },
    ],
  }
}

// One cell: commit its writes, reopen, and compare every public read with the
// model. Soft comparisons keep reaching later checkpoints after a mismatch.
async function runTypedValueCase({
  kind,
  history,
  indexed,
}: (typeof cases)[number]): Promise<void> {
  const harness = scope.create()
  const { adapter } = harness.open()
  await adapter.applyCommittedTx(
    { kind: `eager`, collectionId: collectionId },
    {
      txId: `baseline`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        {
          type: `insert`,
          key: `metadata-only`,
          value: { id: `metadata-only` },
        },
      ],
    },
  )
  await adapter.applyCommittedTx(
    { kind: `eager`, collectionId: collectionId },
    transaction(kind, `insert`),
  )
  if (history === `update`) {
    await adapter.applyCommittedTx(
      { kind: `eager`, collectionId: collectionId },
      transaction(kind, `update`),
    )
  }
  if (indexed) {
    await adapter.ensureIndex(
      { kind: `eager`, collectionId: collectionId },
      `stamp`,
      {
        expressionSql: [JSON.stringify({ type: `ref`, path: [`stamp`] })],
      },
    )
  }

  const { adapter: reopened, database } = harness.open()
  const indexes = database
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (SELECT index_name FROM persisted_index_registry WHERE collection_id = ? AND signature = ?)`,
    )
    .all(collectionId, `stamp`)
  expect(indexes).toHaveLength(indexed ? 1 : 0)
  const expected = expectedRows(kind, history)
  const rows = await reopened.loadSubset(
    { kind: `eager`, collectionId: collectionId },
    {},
  )
  const scanned = await reopened.scanRows(
    { kind: `eager`, collectionId: collectionId },
    {},
  )
  // Soft checks continue to the replay and query checkpoints after a mismatch.
  for (const [checkpoint, actual] of [
    [`hydration`, rows],
    [`scan`, scanned],
  ] as const) {
    check(
      [...actual].sort((a, b) => String(a.key).localeCompare(String(b.key))),
      expected,
      checkpoint,
      expect.soft,
    )
  }
  const metadata = await reopened.loadCollectionMetadata({
    kind: `eager`,
    collectionId: collectionId,
  })
  check(
    metadata,
    [{ key: `checkpoint`, value: payload(expectedValue(kind, 0)) }],
    `collection metadata`,
    expect.soft,
  )

  const seq = history === `insert` ? 2 : 3
  const replay = await reopened.pullSince(
    { kind: `eager`, collectionId: collectionId },
    seq - 1,
  )
  expect(replay.requiresFullReload, `replay payload reached`).toBe(false)
  if (replay.requiresFullReload) throw new Error(`Expected a replay payload`)
  const expectedChangedRows = keys.map((key) => {
    const row = expected.find((entry) => entry.key === key)!
    return { key, value: row.value }
  })
  check(
    replay.deltas,
    [
      {
        txId: `values-${seq}`,
        latestRowVersion: seq,
        changedRows: expectedChangedRows,
        deletedKeys: [],
        rowMetadataMutations: [
          {
            type: `set`,
            key: `metadata-only`,
            value: payload(expectedValue(kind, 1)),
          },
        ],
        collectionMetadataMutations: [
          {
            type: `set`,
            key: `checkpoint`,
            value: payload(expectedValue(kind, 0)),
          },
        ],
      },
    ],
    `transaction replay`,
    expect.soft,
  )

  const earlier = history === `insert` ? keys[0] : keys[1]
  const later = history === `insert` ? keys[1] : keys[0]
  for (const [operator, expectedKey] of [
    [`eq`, earlier],
    [`gt`, later],
  ] as const) {
    const matches = await reopened.loadSubset(
      { kind: `eager`, collectionId: collectionId },
      {
        where: new IR.Func(operator, [
          new IR.PropRef([`stamp`]),
          new IR.Value(inputValue(kind, 0)),
        ]),
      },
    )
    check(
      matches.map((row) => row.key),
      [expectedKey],
      `${operator} query`,
      expect.soft,
    )
  }
  for (const [offset, expectedKey] of [
    [0, earlier],
    [1, later],
  ] as const) {
    const page = await reopened.loadSubset(
      { kind: `eager`, collectionId: collectionId },
      {
        orderBy: [
          {
            expression: new IR.PropRef([`stamp`]),
            compareOptions: { direction: `asc`, nulls: `last` },
          },
        ],
        limit: 1,
        offset,
      },
    )
    check(
      page.map((row) => row.key),
      [expectedKey],
      `ordered page ${offset}`,
      expect.soft,
    )
  }
}

const typedValueLaw = `SQLite typed-value preservation`
describe(`SQLite typed-value preservation after reopen`, () => {
  oracleProperty({
    id: `sqlite-persistence.typed-value-reopen`,
    law: {
      statement: `Accepted Date, ISO string, Temporal.Instant, and Temporal.PlainDate values survive a SQLite close and reopen with their type and value in rows, row and collection metadata, transaction replay, equality and range queries, and an ordered one-row window.`,
      authority: `The core adapter contract that preserves Date and BigInt, and issue #2034's approved v2 design for native Temporal reconstruction.`,
      limits: `The 16 kind, history, and index cells, with one polyfill copy and an in-process reopen; the installed index has a reach witness, not a planner claim.`,
    },
    owns: [`src/sqlite-value.ts`, `src/sqlite-core-adapter.ts`],
    histories: cases,
    label: ({ kind, history, indexed }) =>
      `${kind} / ${history} / indexed=${indexed}`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(typedValueLaw, plan, observe, () =>
        runTypedValueCase(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })
})

// V2 extends the same physical-reopen owner with bounded value families. Rank
// and text come from the independent companion model; SQL never supplies truth.
const nativeTemporalLaw = `SQLite native Temporal query refinement`
// One family: write its values, reopen, and compare each query, cursor, and
// ordered page with the companion rank/text model.
async function runNativeTemporalFamily(family: TemporalFamily): Promise<void> {
  const harness = scope.create()
  const { adapter } = harness.open()
  await adapter.applyCommittedTx(
    { kind: `eager`, collectionId: collectionId },
    {
      txId: `seed`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: family.texts.map((_, i) => ({
        type: `insert`,
        key: `row-${i}`,
        value: {
          stamp: temporalValue(family, i),
          target: temporalValue(family, 1),
        },
      })),
    },
  )
  const { adapter: reopened } = harness.open()
  for (const query of temporalQueryCases(family)) {
    const rows = await reopened.loadSubset(
      { kind: `eager`, collectionId: collectionId },
      {
        where: query.where,
      },
    )
    expect
      .soft(rows.map((row) => row.key).sort(), query.name)
      .toEqual(query.expectedKeys)
  }
  const target = new IR.Value(temporalValue(family, 1))
  const stamp = new IR.PropRef([`stamp`])
  const cursorRows = await reopened.loadSubset(
    { kind: `eager`, collectionId: collectionId },
    {
      cursor: {
        whereCurrent: new IR.Func(`and`, [
          new IR.Func(`gte`, [stamp, target]),
          new IR.Func(`lte`, [stamp, target]),
        ]),
        whereFrom: new IR.Func(`gt`, [stamp, target]),
      },
      orderBy: [
        {
          expression: stamp,
          compareOptions: { direction: `asc`, nulls: `last` },
        },
      ],
      limit: 1,
    },
  )
  const currentKeys = family.texts.flatMap((_, i) =>
    family.ranks[i] === family.ranks[1] ? [`row-${i}`] : [],
  )
  const followingKeys = family.texts
    .flatMap((_, i) => (family.ranks[i]! > family.ranks[1] ? [`row-${i}`] : []))
    .slice(0, 1)
  expect
    .soft(
      cursorRows.map((row) => row.key),
      `cursor tie group and continuation`,
    )
    .toEqual([...currentKeys, ...followingKeys])
  const ordered = family.texts
    .map((_, i) => i)
    .sort((a, b) => family.ranks[a]! - family.ranks[b]! || a - b)
  for (const [offset, index] of ordered.entries()) {
    const rows = await reopened.loadSubset(
      { kind: `eager`, collectionId: collectionId },
      {
        orderBy: [
          {
            expression: new IR.PropRef([`stamp`]),
            compareOptions: { direction: `asc`, nulls: `last` },
          },
        ],
        offset,
        limit: 1,
      },
    )
    expect.soft(rows.map((row) => row.key)).toEqual([`row-${index}`])
    check(
      rows[0]?.value.stamp,
      { kind: family.kind, text: family.texts[index] },
      `native result`,
      expect.soft,
    )
  }
}

describe(`native Temporal query refinement`, () => {
  oracleProperty({
    id: `sqlite-persistence.native-temporal-query`,
    law: {
      statement: `Native Temporal values written to SQLite answer equality, range, cursor, and ordered-page queries after a reopen as the companion rank/text model orders them, and reconstruct as the same kind and text.`,
      authority: `Issue #2034's approved v2 design for native Temporal reconstruction, with the companion model in temporal-value-oracle.ts.`,
      limits: `The bounded Instant and PlainDate families of temporal-value-oracle.ts, with one polyfill copy and an in-process reopen.`,
    },
    owns: [`src/sqlite-value.ts`, `src/sqlite-core-adapter.ts`],
    histories: temporalFamilies,
    label: ({ kind, name }) => `${kind} / ${name}`,
    resolve: (family) => ({ family }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(nativeTemporalLaw, plan, observe, () =>
        runNativeTemporalFamily(plan.family),
      ),
    check: forwardAssertionJudgment,
  })
})
