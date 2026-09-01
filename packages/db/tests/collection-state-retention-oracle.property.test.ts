import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DuplicateKeySyncError } from '../src/errors.js'
import { oraclePropertyOptions } from './oracle-config.js'
import type { Collection } from '../src/collection/index.js'
import type { SyncConfig } from '../src/types.js'

type RetainedRow = {
  id: number
  value: number
}

type SyncActions = Parameters<SyncConfig<RetainedRow, number>[`sync`]>[0]

type RetentionAction =
  | { type: `insert`; row: RetainedRow }
  | { type: `update`; row: RetainedRow }
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
  retainedRowArbitrary.map((row) => ({ type: `insert` as const, row })),
  retainedRowArbitrary.map((row) => ({ type: `update` as const, row })),
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
    case `insert`: {
      const previous = model.get(action.row.id)
      if (previous !== undefined && previous.value !== action.row.value) {
        expect(() => sync.write({ type: `insert`, value: action.row })).toThrow(
          DuplicateKeySyncError,
        )
        break
      }
      sync.write({ type: `insert`, value: action.row })
      model.set(action.row.id, action.row)
      break
    }
    case `update`: {
      sync.write({ type: action.type, value: action.row })
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
    { type: `insert`, row: { id: 1, value: 1 } },
    { type: `insert`, row: { id: 2, value: 2 } },
    { type: `delete`, key: 1 },
    { type: `update`, row: { id: 1, value: -1 } },
    { type: `replace`, rows: [{ id: 3, value: 0 }] },
    { type: `delete`, key: 3 },
  ])
})

it(`retains a missing row introduced by a sync update`, async () => {
  await runRetentionHistory([{ type: `update`, row: { id: 1, value: 1 } }])
})

it(`releases retained keys after long unique-key churn`, async () => {
  const keyCount = 1_000
  const actions: Array<RetentionAction> = []
  for (let key = 0; key < keyCount; key++) {
    actions.push({ type: `insert`, row: { id: key, value: key } })
    actions.push({ type: `delete`, key })
  }

  await runRetentionHistory(actions)
})

fcTest.prop(
  [fc.array(retentionActionArbitrary, { minLength: 1, maxLength: 20 })],
  oraclePropertyOptions(100, `collection-state.retention`),
)(
  `matches retained authoritative state without optimistic overlays after every committed sync history`,
  async (actions) => {
    await runRetentionHistory(actions)
  },
)
