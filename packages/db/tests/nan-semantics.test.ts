import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { eq, gt, inArray, lt } from '../src/query/builder/functions'
import { PropRef } from '../src/query/ir'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import type { BasicExpression } from '../src/query/ir'

/**
 * The query engine follows PostgreSQL float semantics for `NaN`: it is equal to
 * itself and greater than every other (non-null) value, so it has a
 * well-defined order and behaves like a normal value in `where` clauses and
 * `orderBy`. These tests also assert that querying with an index produces the
 * same result as a full scan.
 */
interface Row {
  id: string
  score: number
}

const data: Array<Row> = [
  { id: `nan`, score: NaN },
  { id: `one`, score: 1 },
  { id: `three`, score: 3 },
  { id: `five`, score: 5 },
  { id: `seven`, score: 7 },
]

function makeCollection() {
  const collection = createCollection<Row, string>({
    getKey: (row) => row.id,
    startSync: true,
    autoIndex: `off`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of data) write({ type: `insert`, value: row })
        commit()
        markReady()
      },
    },
  })
  return collection
}

async function queryBothPaths(where: BasicExpression<boolean>) {
  const indexed = makeCollection()
  await indexed.stateWhenReady()
  indexed.createIndex((row) => row.score)
  const fullScan = makeCollection()
  await fullScan.stateWhenReady()

  const indexedIds = indexed
    .currentStateAsChanges({ where })!
    .map((c) => c.value.id)
    .sort()
  const fullScanIds = fullScan
    .currentStateAsChanges({ where })!
    .map((c) => c.value.id)
    .sort()

  // The chosen execution strategy must not change the result
  expect(indexedIds).toEqual(fullScanIds)
  return indexedIds
}

describe(`NaN query semantics (PostgreSQL float semantics)`, () => {
  it(`matches NaN rows for equality on NaN`, async () => {
    expect(await queryBothPaths(eq(new PropRef([`score`]), NaN))).toEqual([
      `nan`,
    ])
  })

  it(`treats NaN as greater than every number in a range query`, async () => {
    // score > 2 matches 3, 5, 7 and NaN (NaN is greatest)
    expect(await queryBothPaths(gt(new PropRef([`score`]), 2))).toEqual([
      `five`,
      `nan`,
      `seven`,
      `three`,
    ])
  })

  it(`excludes NaN from a less-than range query`, async () => {
    // score < 4 matches 1 and 3, but not NaN (NaN is greatest)
    expect(await queryBothPaths(lt(new PropRef([`score`]), 4))).toEqual([
      `one`,
      `three`,
    ])
  })

  it(`matches a NaN member of an IN list`, async () => {
    expect(
      await queryBothPaths(inArray(new PropRef([`score`]), [NaN, 3])),
    ).toEqual([`nan`, `three`])
  })

  it(`orders NaN last when sorting ascending`, async () => {
    const collection = makeCollection()
    await collection.stateWhenReady()

    const ordered = collection
      .currentStateAsChanges({
        orderBy: [
          {
            expression: new PropRef([`score`]),
            compareOptions: { direction: `asc`, nulls: `first` },
          },
        ],
      })!
      .map((c) => c.value.id)

    expect(ordered).toEqual([`one`, `three`, `five`, `seven`, `nan`])
  })
})

/**
 * Invalid Dates have a `NaN` timestamp, so they follow the same PostgreSQL
 * float semantics as `NaN`: equal to one another and greater than every valid
 * Date. The indexed and full-scan paths must agree.
 */
describe(`invalid Date query semantics (PostgreSQL float semantics)`, () => {
  interface DateRow {
    id: string
    createdAt: Date
  }

  const valid = new Date(`2023-01-01`)
  const dateData: Array<DateRow> = [
    { id: `invalid`, createdAt: new Date(`not a date`) },
    { id: `valid`, createdAt: valid },
  ]

  function makeDateCollection() {
    return createCollection<DateRow, string>({
      getKey: (row) => row.id,
      startSync: true,
      autoIndex: `off`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const row of dateData) write({ type: `insert`, value: row })
          commit()
          markReady()
        },
      },
    })
  }

  async function queryDateBothPaths(where: BasicExpression<boolean>) {
    const indexed = makeDateCollection()
    await indexed.stateWhenReady()
    indexed.createIndex((row) => row.createdAt)
    const fullScan = makeDateCollection()
    await fullScan.stateWhenReady()

    const indexedIds = indexed
      .currentStateAsChanges({ where })!
      .map((c) => c.value.id)
      .sort()
    const fullScanIds = fullScan
      .currentStateAsChanges({ where })!
      .map((c) => c.value.id)
      .sort()

    expect(indexedIds).toEqual(fullScanIds)
    return indexedIds
  }

  it(`matches invalid-Date rows for equality on an invalid Date`, async () => {
    expect(
      await queryDateBothPaths(
        eq(new PropRef([`createdAt`]), new Date(`not a date`)),
      ),
    ).toEqual([`invalid`])
  })

  it(`matches an invalid-Date member of an IN list`, async () => {
    expect(
      await queryDateBothPaths(
        inArray(new PropRef([`createdAt`]), [new Date(`not a date`), valid]),
      ),
    ).toEqual([`invalid`, `valid`])
  })

  it(`treats an invalid Date as greater than valid Dates in a range query`, async () => {
    // createdAt > 2022 matches the valid Date and the invalid Date (greatest)
    expect(
      await queryDateBothPaths(
        gt(new PropRef([`createdAt`]), new Date(`2022-01-01`)),
      ),
    ).toEqual([`invalid`, `valid`])
  })
})
