import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { oraclePropertyOptions } from './oracle-config.js'
import type { Collection } from '../src/collection/index.js'
import type { SyncConfig } from '../src/types.js'

type RetainedRow = {
  id: number
  value: number
}

type SyncActions = Parameters<SyncConfig<RetainedRow, number>[`sync`]>[0]

type RetentionAction =
  | { type: `put`; row: RetainedRow }
  | { type: `delete`; key: number }
  | { type: `replace`; rows: ReadonlyArray<RetainedRow> }

type RetentionHarness = {
  collection: Collection<RetainedRow, number>
  sync: SyncActions
}

const retainedRowArbitrary = fc.record({
  id: fc.integer({ min: 0, max: 3 }),
  value: fc.integer({ min: -2, max: 2 }),
})

const retentionActionArbitrary: fc.Arbitrary<RetentionAction> = fc.oneof(
  retainedRowArbitrary.map((row) => ({ type: `put` as const, row })),
  fc
    .integer({ min: 0, max: 3 })
    .map((key) => ({ type: `delete` as const, key })),
  fc
    .uniqueArray(retainedRowArbitrary, {
      selector: (row) => row.id,
      maxLength: 4,
    })
    .map((rows) => ({ type: `replace` as const, rows })),
)

function createRetentionHarness(): RetentionHarness {
  let sync!: SyncActions
  const collection = createCollection<RetainedRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.markReady()
      },
    },
  })
  return { collection, sync }
}

function applyAction(
  action: RetentionAction,
  model: Map<number, RetainedRow>,
  sync: SyncActions,
): void {
  sync.begin()
  switch (action.type) {
    case `put`: {
      sync.write({
        type: model.has(action.row.id) ? `update` : `insert`,
        value: action.row,
      })
      model.set(action.row.id, action.row)
      break
    }
    case `delete`:
      sync.write({ type: `delete`, key: action.key })
      model.delete(action.key)
      break
    case `replace`:
      sync.truncate()
      model.clear()
      for (const row of action.rows) {
        sync.write({ type: `insert`, value: row })
        model.set(row.id, row)
      }
      break
  }
  expect(sync.commit()).toBe(true)
}

function expectRetainedState(
  collection: Collection<RetainedRow, number>,
  model: ReadonlyMap<number, RetainedRow>,
): void {
  const expectedRows = [...model.entries()].sort(([a], [b]) => a - b)
  const retainedRows = [...collection._state.syncedData.entries()].sort(
    ([a], [b]) => a - b,
  )

  expect(retainedRows).toEqual(expectedRows)
  expect([...collection._state.syncedKeys].sort((a, b) => a - b)).toEqual(
    expectedRows.map(([key]) => key),
  )
  expect(
    [...collection.state.entries()]
      .map(([key, row]) => [key, { id: row.id, value: row.value }] as const)
      .sort(([a], [b]) => a - b),
  ).toEqual(expectedRows)
}

async function runRetentionHistory(
  actions: ReadonlyArray<RetentionAction>,
): Promise<void> {
  const { collection, sync } = createRetentionHarness()
  const model = new Map<number, RetainedRow>()
  try {
    expectRetainedState(collection, model)
    for (const action of actions) {
      applyAction(action, model, sync)
      expectRetainedState(collection, model)
    }
  } finally {
    await collection.cleanup()
  }
}

it(`retains only keys in the authoritative synced state`, async () => {
  await runRetentionHistory([
    { type: `put`, row: { id: 1, value: 1 } },
    { type: `put`, row: { id: 2, value: 2 } },
    { type: `delete`, key: 1 },
    { type: `put`, row: { id: 1, value: -1 } },
    { type: `replace`, rows: [{ id: 3, value: 0 }] },
    { type: `delete`, key: 3 },
  ])
})

fcTest.prop(
  [fc.array(retentionActionArbitrary, { minLength: 1, maxLength: 20 })],
  oraclePropertyOptions(100, `collection-state.retention`),
)(
  `matches retained authoritative state after every committed sync history`,
  async (actions) => {
    await runRetentionHistory(actions)
  },
)
