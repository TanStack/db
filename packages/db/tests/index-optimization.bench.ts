import { bench, describe } from 'vitest'
import mitt from 'mitt'
import { createCollection } from '../src/collection/index.js'
import { and, eq } from '../src/query/builder/functions'
import { PropRef } from '../src/query/ir'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import type { Collection } from '../src/collection/index.js'

interface Row {
  id: string
  age: number
  status: 'active' | 'inactive' | 'pending' | 'archived'
  name: string
}

const COLLECTION_SIZE = 10_000
const TARGET_AGE = 25
const TARGET_NAME = `user-2500`

function buildData(): Array<Row> {
  const statuses: Array<Row['status']> = [
    `active`,
    `inactive`,
    `pending`,
    `archived`,
  ]
  const rows: Array<Row> = []
  for (let i = 0; i < COLLECTION_SIZE; i++) {
    rows.push({
      id: String(i),
      age: i % 100,
      status: statuses[i % 4]!,
      name: `user-${i}`,
    })
  }
  return rows
}

function buildCollection(
  data: Array<Row>,
  indexFields: Array<keyof Row>,
): Collection<Row, string> {
  const emitter = mitt()
  const collection = createCollection<Row, string>({
    getKey: (item) => item.id,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const item of data) {
          write({ type: `insert`, value: item })
        }
        commit()
        markReady()
        if (!emitter.all.has(`sync`)) {
          emitter.on(`sync`, () => {})
        }
      },
    },
  })
  for (const field of indexFields) {
    collection.createIndex((row: Row) => row[field], {
      indexType: BTreeIndex,
    })
  }
  return collection
}

const data = buildData()
const expectedMatches = data.filter(
  (r) => r.age === TARGET_AGE && r.name === TARGET_NAME,
).length

const whereExpr = and(
  eq(new PropRef([`age`]), TARGET_AGE),
  eq(new PropRef([`name`]), TARGET_NAME),
)

// Sanity-check the scenarios return identical results before benching.
const collections = {
  fullScan: buildCollection(data, []),
  partialIndex: buildCollection(data, [`age`]),
  fullIndex: buildCollection(data, [`age`, `name`]),
}
for (const [label, col] of Object.entries(collections)) {
  const result = col.currentStateAsChanges({ where: whereExpr })
  if (result === undefined) {
    throw new Error(
      `Bench setup soundness check failed for ${label}: ` +
        `currentStateAsChanges returned undefined`,
    )
  }
  if (result.length !== expectedMatches) {
    throw new Error(
      `Bench setup soundness check failed for ${label}: ` +
        `expected ${expectedMatches} match(es), got ${result.length}`,
    )
  }
}

describe(`index-optimization: AND with mixed indexed/unindexed branches`, () => {
  bench(`full scan (no indexes)`, () => {
    collections.fullScan.currentStateAsChanges({ where: whereExpr })
  })

  bench(`partial index (age only — residual on name)`, () => {
    collections.partialIndex.currentStateAsChanges({ where: whereExpr })
  })

  bench(`full index (age + name)`, () => {
    collections.fullIndex.currentStateAsChanges({ where: whereExpr })
  })
})
