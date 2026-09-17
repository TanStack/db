import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import {
  createCollection,
  createLiveQueryCollection,
  eq,
} from '../src/index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { createEffect } from '../src/query/effect.js'
import { reconcileChangesForD2 } from '../src/query/live/utils.js'
import { oraclePropertyOptions, oracleRuns } from './oracle-config.js'
import { flushPromises } from './utils.js'
import type { ChangeMessage, SyncConfig } from '../src/types.js'

type SourceRow = {
  id: number
  revision: number
  value: number
}

type SourceSyncActions = Parameters<SyncConfig<SourceRow, number>[`sync`]>[0]

type SourceKey = string | number

type SourceOperation =
  | {
      type: `upsert`
      key: SourceKey
      row: SourceRow
      reportedPreviousValue: SourceRow
    }
  | {
      type: `rawUpdate`
      key: SourceKey
      row: SourceRow
      reportedPreviousValue: SourceRow
    }
  | { type: `replay`; key: SourceKey }
  | { type: `delete`; key: SourceKey; reportedValue: SourceRow }

type ReconciliationStep =
  | { type: `batch`; operations: ReadonlyArray<SourceOperation> }
  | { type: `truncate` }
  | { type: `teardown` }
  | { type: `restart` }

type ReconciliationModel = {
  // Only sourceRows is expected state. sentRows belongs to the real helper;
  // relation independently integrates that helper's raw weighted output.
  sourceRows: Map<SourceKey, SourceRow>
  sentRows: Map<SourceKey, SourceRow>
  relation: Map<string, number>
  graphActive: boolean
}

type Reconciler = (
  changes: Array<ChangeMessage<SourceRow, SourceKey>>,
  sentRows: Map<SourceKey, SourceRow>,
) => Array<ChangeMessage<SourceRow, SourceKey>>

const sourceRowArbitrary = fc.record({
  id: fc.integer({ min: 0, max: 3 }),
  revision: fc.integer({ min: 0, max: 4 }),
  value: fc.integer({ min: -2, max: 2 }),
})

const sourceKeyArbitrary: fc.Arbitrary<SourceKey> = fc.oneof(
  fc.integer({ min: 0, max: 2 }),
  fc.constantFrom(`0`, `1`, `source`),
)

const sourceOperationArbitrary: fc.Arbitrary<SourceOperation> = fc.oneof(
  fc
    .record({
      key: sourceKeyArbitrary,
      row: sourceRowArbitrary,
      reportedPreviousValue: sourceRowArbitrary,
    })
    .map((operation) => ({ type: `upsert` as const, ...operation })),
  fc
    .record({
      key: sourceKeyArbitrary,
      row: sourceRowArbitrary,
      reportedPreviousValue: sourceRowArbitrary,
    })
    .map((operation) => ({ type: `rawUpdate` as const, ...operation })),
  sourceKeyArbitrary.map((key) => ({ type: `replay` as const, key })),
  fc
    .record({
      key: sourceKeyArbitrary,
      reportedValue: sourceRowArbitrary,
    })
    .map((operation) => ({ type: `delete` as const, ...operation })),
)

const reconciliationStepArbitrary: fc.Arbitrary<ReconciliationStep> = fc.oneof(
  {
    weight: 8,
    arbitrary: fc
      .array(sourceOperationArbitrary, { minLength: 1, maxLength: 5 })
      .map((operations) => ({ type: `batch` as const, operations })),
  },
  { weight: 1, arbitrary: fc.constant({ type: `truncate` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `teardown` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `restart` as const }) },
)

const reconciliationHistoryArbitrary = fc.array(reconciliationStepArbitrary, {
  minLength: 1,
  maxLength: 30,
})

function sourceOperationForKeyArbitrary(
  key: SourceKey,
): fc.Arbitrary<SourceOperation> {
  return fc.oneof(
    fc
      .tuple(sourceRowArbitrary, sourceRowArbitrary)
      .map(([row, reportedPreviousValue]) => ({
        type: `upsert` as const,
        key,
        row,
        reportedPreviousValue,
      })),
    fc
      .tuple(sourceRowArbitrary, sourceRowArbitrary)
      .map(([row, reportedPreviousValue]) => ({
        type: `rawUpdate` as const,
        key,
        row,
        reportedPreviousValue,
      })),
    fc.constant({ type: `replay` as const, key }),
    sourceRowArbitrary.map((reportedValue) => ({
      type: `delete` as const,
      key,
      reportedValue,
    })),
  )
}

const disjointHistoriesArbitrary = fc.tuple(
  fc.array(sourceOperationForKeyArbitrary(0), {
    minLength: 1,
    maxLength: 8,
  }),
  fc.array(sourceOperationForKeyArbitrary(`other`), {
    minLength: 1,
    maxLength: 8,
  }),
)

function rowIdentity(row: SourceRow): string {
  return `${row.id}:${row.revision}:${row.value}`
}

function expectedWeightedRowIdentity(key: SourceKey, row: SourceRow): string {
  const sourceIdentity = [typeof key, String(key)].join(`:`)
  const payloadIdentity = [row.id, row.revision, row.value]
    .map(String)
    .join(`:`)
  return `${sourceIdentity}|${payloadIdentity}`
}

function addWeight(
  relation: Map<string, number>,
  key: SourceKey,
  row: SourceRow,
  weight: 1 | -1,
): void {
  const identity = `${typeof key}:${String(key)}|${rowIdentity(row)}`
  const nextWeight = (relation.get(identity) ?? 0) + weight
  if (nextWeight === 0) relation.delete(identity)
  else relation.set(identity, nextWeight)
}

function applyToRelation(
  relation: Map<string, number>,
  changes: ReadonlyArray<ChangeMessage<SourceRow, SourceKey>>,
): void {
  for (const change of changes) {
    if (change.type === `insert`) {
      addWeight(relation, change.key, change.value, 1)
    } else if (change.type === `update`) {
      addWeight(relation, change.key, change.previousValue!, -1)
      addWeight(relation, change.key, change.value, 1)
    } else {
      addWeight(relation, change.key, change.value, -1)
    }
  }
}

function sourceChangesFor(
  operations: ReadonlyArray<SourceOperation>,
  sourceRows: Map<SourceKey, SourceRow>,
): Array<ChangeMessage<SourceRow, SourceKey>> {
  const changes: Array<ChangeMessage<SourceRow, SourceKey>> = []
  for (const operation of operations) {
    if (operation.type === `upsert`) {
      const previousValue = sourceRows.get(operation.key)
      changes.push(
        previousValue === undefined
          ? { type: `insert`, key: operation.key, value: { ...operation.row } }
          : {
              type: `update`,
              key: operation.key,
              value: { ...operation.row },
              previousValue: { ...operation.reportedPreviousValue },
            },
      )
      sourceRows.set(operation.key, { ...operation.row })
    } else if (operation.type === `rawUpdate`) {
      changes.push({
        type: `update`,
        key: operation.key,
        value: { ...operation.row },
        previousValue: { ...operation.reportedPreviousValue },
      })
      sourceRows.set(operation.key, { ...operation.row })
    } else if (operation.type === `replay`) {
      const row = sourceRows.get(operation.key)
      if (row !== undefined) {
        changes.push({ type: `insert`, key: operation.key, value: { ...row } })
      }
    } else {
      changes.push({
        type: `delete`,
        key: operation.key,
        value: { ...operation.reportedValue },
      })
      sourceRows.delete(operation.key)
    }
  }
  return changes
}

function expectTrackerMatchesSource(
  sourceRows: ReadonlyMap<SourceKey, SourceRow>,
  sentRows: ReadonlyMap<SourceKey, SourceRow>,
): void {
  const compareEntries = (
    [a]: readonly [SourceKey, SourceRow],
    [b]: readonly [SourceKey, SourceRow],
  ) => `${typeof a}:${String(a)}`.localeCompare(`${typeof b}:${String(b)}`)
  expect([...sentRows.entries()].sort(compareEntries)).toEqual(
    [...sourceRows.entries()].sort(compareEntries),
  )
}

function expectWeightedRelationMatchesSource(
  sourceRows: ReadonlyMap<SourceKey, SourceRow>,
  relation: ReadonlyMap<string, number>,
): void {
  expect(
    [...relation.entries()].sort(([a], [b]) => a.localeCompare(b)),
  ).toEqual(
    [...sourceRows.entries()]
      .map(([key, row]) => [expectedWeightedRowIdentity(key, row), 1] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

function createReconciliationModel(): ReconciliationModel {
  return {
    sourceRows: new Map(),
    sentRows: new Map(),
    relation: new Map(),
    graphActive: true,
  }
}

function snapshotModel(model: ReconciliationModel): {
  source: Array<string>
  sent: Array<string>
  relation: Array<readonly [string, number]>
} {
  const rows = (entries: ReadonlyMap<SourceKey, SourceRow>) =>
    [...entries]
      .map(
        ([key, row]) =>
          `${typeof key}:${String(key)}|${row.id}:${row.revision}:${row.value}`,
      )
      .sort()
  return {
    source: rows(model.sourceRows),
    sent: rows(model.sentRows),
    relation: [...model.relation].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  }
}

function applyReconciliationStep(
  model: ReconciliationModel,
  step: ReconciliationStep,
  reconcile: Reconciler = reconcileChangesForD2,
): void {
  // This is a helper/session simulation, not real graph restart wiring.
  // The separate Effect/live tests below inject events at a real consumer.
  if (step.type === `truncate`) {
    // Truncate is only an early lifecycle signal. Its later source batch
    // still needs the retained exact rows to retract the active graph.
  } else if (step.type === `teardown`) {
    model.sentRows.clear()
    model.relation.clear()
    model.graphActive = false
  } else if (step.type === `restart`) {
    if (!model.graphActive) {
      const replay = [...model.sourceRows].map(([key, value]) => ({
        type: `insert` as const,
        key,
        value: { ...value },
      }))
      applyToRelation(model.relation, reconcile(replay, model.sentRows))
      model.graphActive = true
    }
  } else {
    const changes = sourceChangesFor(step.operations, model.sourceRows)
    if (model.graphActive) {
      const reconciled = reconcile(changes, model.sentRows)
      applyToRelation(model.relation, reconciled)
    }
  }

  if (model.graphActive) {
    expectTrackerMatchesSource(model.sourceRows, model.sentRows)
    expectWeightedRelationMatchesSource(model.sourceRows, model.relation)
  } else {
    expect(model.sentRows.size).toBe(0)
    expect(model.relation.size).toBe(0)
  }
}

function upsert(
  key: SourceKey,
  row: SourceRow,
  reportedPreviousValue: SourceRow = row,
): ReconciliationStep {
  return {
    type: `batch`,
    operations: [{ type: `upsert`, key, row, reportedPreviousValue }],
  }
}

function createOrderedSourceHarness(id: string) {
  // Intentional fault-injection boundary: substitute stale subscription events
  // while retaining the actual ordered Effect/live-query consumer. This does
  // not establish that a particular SDK emits these events naturally.
  let sync!: SourceSyncActions
  let loadSubsetCalls = 0
  const replayResolvers: Array<() => void> = []
  const contributed = { id: 1, revision: 1, value: 1 }
  const staleDelete = { id: 1, revision: 2, value: 1 }
  const replacement = { id: 1, revision: 3, value: 2 }
  const source = createCollection<SourceRow, number>({
    id,
    getKey: (row) => row.id,
    startSync: true,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.markReady()
        return {
          loadSubset: () => {
            loadSubsetCalls++
            // Initial page and its exact tie-boundary refinement are immediate;
            // later calls are truncate replays controlled by the test.
            if (loadSubsetCalls > 2) {
              return new Promise((resolve) => replayResolvers.push(resolve))
            }
            return true
          },
        }
      },
    },
  })
  sync.begin()
  sync.write({ type: `insert`, value: contributed })
  expect(sync.commit()).toBe(true)

  let sourceCallback: Parameters<typeof source.subscribeChanges>[0] | undefined
  let suppressSourceChanges = false
  const subscribeChanges = source.subscribeChanges.bind(source)
  source.subscribeChanges = ((callback, options) => {
    sourceCallback = callback
    return subscribeChanges((changes) => {
      if (!suppressSourceChanges) callback(changes)
    }, options)
  }) as typeof source.subscribeChanges

  return {
    contributed,
    replacement,
    source,
    staleDelete,
    suppressSourceChanges: () => {
      suppressSourceChanges = true
    },
    publish: (changes: Array<ChangeMessage<SourceRow, number>>) => {
      if (sourceCallback === undefined) {
        throw new Error(`Query did not subscribe to its source`)
      }
      const publish = sourceCallback as unknown as (
        messages: Array<ChangeMessage<SourceRow, number>>,
      ) => void
      publish(changes)
    },
    truncate: () => {
      sync.begin()
      sync.truncate()
      expect(sync.commit()).toBe(true)
    },
    resolveReplay: async () => {
      if (replayResolvers.length === 0) {
        throw new Error(`No truncate replay is pending`)
      }
      for (let pass = 0; replayResolvers.length > 0; pass++) {
        if (pass === 20) {
          throw new Error(
            `Truncate replay did not reach a fixed point after 20 passes`,
          )
        }
        for (const resolve of replayResolvers.splice(0)) resolve()
        await flushPromises()
      }
    },
  }
}

it(`ignores unknown deletes and inserts unknown updates at the D2 boundary`, () => {
  const sentRows = new Map<SourceKey, SourceRow>()
  const stale = { id: 1, revision: 1, value: 1 }
  const current = { id: 2, revision: 2, value: 2 }

  expect(
    reconcileChangesForD2(
      [{ type: `delete`, key: `row`, value: stale }],
      sentRows,
    ),
  ).toEqual([])
  expect(
    reconcileChangesForD2(
      [
        {
          type: `update`,
          key: `row`,
          previousValue: stale,
          value: current,
        },
      ],
      sentRows,
    ),
  ).toEqual([{ type: `insert`, key: `row`, value: current }])
  expect(sentRows).toEqual(new Map([[`row`, current]]))
})

it(`retracts the exact Effect source row after an ordered truncate`, async () => {
  const harness = createOrderedSourceHarness(
    `d2-effect-truncate-reconciliation`,
  )
  const { contributed, source, staleDelete } = harness
  const events: Array<{
    type: string
    value: { id: number; revision: number; value: number }
  }> = []
  const effect = createEffect<SourceRow, number>({
    query: (query) =>
      query
        .from({ row: source })
        .where(({ row }) => eq(row.revision, contributed.revision))
        .orderBy(({ row }) => row.value)
        .limit(1),
    onBatch: (batch) => {
      events.push(...batch)
    },
  })
  try {
    await flushPromises()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: `enter`,
      key: 1,
      value: contributed,
    })
    const publishedValue = events[0]!.value

    harness.suppressSourceChanges()
    harness.truncate()
    await flushPromises()
    expect(events).toEqual([{ type: `enter`, key: 1, value: publishedValue }])

    harness.publish([{ type: `delete`, key: 1, value: staleDelete }])
    await flushPromises()
    expect(events).toEqual([
      { type: `enter`, key: 1, value: publishedValue },
      { type: `exit`, key: 1, value: publishedValue },
    ])
  } finally {
    await effect.dispose()
    await source.cleanup()
  }
})

it(`retracts the exact live-query source row after ordered replay settles`, async () => {
  const harness = createOrderedSourceHarness(
    `d2-live-query-truncate-reconciliation`,
  )
  const { contributed, source, staleDelete } = harness
  const live = createLiveQueryCollection({
    id: `d2-live-query-truncate-result`,
    query: (query) =>
      query
        .from({ row: source })
        .where(({ row }) => eq(row.revision, contributed.revision))
        .orderBy(({ row }) => row.value)
        .limit(1),
    startSync: true,
  })

  try {
    await live.preload()
    expect(live.get(contributed.id)).toMatchObject(contributed)

    harness.suppressSourceChanges()
    harness.truncate()
    await flushPromises()
    expect(live.get(contributed.id)).toMatchObject(contributed)

    harness.publish([{ type: `delete`, key: 1, value: staleDelete }])
    await flushPromises()
    expect(live.get(contributed.id)).toMatchObject(contributed)

    await harness.resolveReplay()
    expect(live.get(contributed.id)).toBeUndefined()
  } finally {
    await live.cleanup()
    await source.cleanup()
  }
})

it(`replaces the retained Effect source row after an ordered truncate`, async () => {
  const harness = createOrderedSourceHarness(`d2-effect-truncate-replacement`)
  const { contributed, replacement, source, staleDelete } = harness
  const batches: Array<
    Array<{
      type: string
      value: SourceRow
      previousValue?: SourceRow
    }>
  > = []
  const effect = createEffect<SourceRow, number>({
    query: (query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.value)
        .limit(1),
    onBatch: (batch) => {
      batches.push(batch)
    },
  })

  try {
    await flushPromises()
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(1)
    expect(batches[0]![0]).toMatchObject({
      type: `enter`,
      key: 1,
      value: contributed,
    })
    const publishedValue = batches[0]![0]!.value

    harness.suppressSourceChanges()
    harness.truncate()
    await flushPromises()
    expect(batches).toHaveLength(1)

    harness.publish([
      {
        type: `update`,
        key: 1,
        previousValue: staleDelete,
        value: replacement,
      },
    ])
    await flushPromises()
    expect(batches).toHaveLength(2)
    expect(batches[1]).toHaveLength(1)
    expect(batches[1]![0]).toMatchObject({
      type: `update`,
      key: 1,
      value: replacement,
    })
    expect(batches[1]![0]!.previousValue).toBe(publishedValue)
  } finally {
    await effect.dispose()
    await source.cleanup()
  }
})

it(`replaces the retained live-query source row after ordered replay settles`, async () => {
  const harness = createOrderedSourceHarness(
    `d2-live-query-truncate-replacement`,
  )
  const { contributed, replacement, source, staleDelete } = harness
  const live = createLiveQueryCollection({
    id: `d2-live-query-truncate-replacement-result`,
    query: (query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.value)
        .limit(1),
    startSync: true,
  })
  const batches: Array<Array<ChangeMessage<SourceRow, SourceKey>>> = []

  try {
    await live.preload()
    expect(live.get(contributed.id)).toMatchObject(contributed)
    const publishedValue = live.get(contributed.id)
    const subscription = live.subscribeChanges(
      (changes) => batches.push(changes),
      { includeInitialState: false },
    )

    harness.suppressSourceChanges()
    harness.truncate()
    await flushPromises()
    expect(batches).toEqual([])
    expect(live.get(contributed.id)).toBe(publishedValue)

    harness.publish([
      {
        type: `update`,
        key: 1,
        previousValue: staleDelete,
        value: replacement,
      },
    ])
    await flushPromises()
    expect(batches).toEqual([])
    expect(live.get(contributed.id)).toBe(publishedValue)

    await harness.resolveReplay()
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(1)
    expect(batches[0]![0]).toMatchObject({
      type: `update`,
      key: 1,
      value: replacement,
    })
    expect(batches[0]![0]!.previousValue).toEqual(publishedValue)
    expect(live.get(replacement.id)).toMatchObject(replacement)
    subscription.unsubscribe()
  } finally {
    await live.cleanup()
    await source.cleanup()
  }
})

it(`keeps revision and value in weighted row identity`, () => {
  const key = `row`
  const base = { id: 1, revision: 1, value: 1 }
  const differentRevision = { id: 1, revision: 2, value: 1 }
  const differentValue = { id: 1, revision: 1, value: 2 }
  const relation = new Map<string, number>()

  addWeight(relation, key, base, 1)
  addWeight(relation, key, differentRevision, 1)
  addWeight(relation, key, differentValue, 1)

  expect(relation).toEqual(
    new Map([
      [expectedWeightedRowIdentity(key, base), 1],
      [expectedWeightedRowIdentity(key, differentRevision), 1],
      [expectedWeightedRowIdentity(key, differentValue), 1],
    ]),
  )
})

it(`keeps numeric and string source keys distinct across restart`, () => {
  const model = createReconciliationModel()
  const row = { id: 1, revision: 1, value: 1 }
  const keys = [0, `0`] as const

  applyReconciliationStep(model, {
    type: `batch`,
    operations: keys.map((key) => ({
      type: `upsert` as const,
      key,
      row,
      reportedPreviousValue: row,
    })),
  })
  expect(model.sourceRows).toEqual(
    new Map<SourceKey, SourceRow>([
      [0, row],
      [`0`, row],
    ]),
  )
  expect(model.sentRows).toEqual(model.sourceRows)
  expect(model.relation).toEqual(
    new Map([
      [expectedWeightedRowIdentity(0, row), 1],
      [expectedWeightedRowIdentity(`0`, row), 1],
    ]),
  )

  applyReconciliationStep(model, { type: `teardown` })
  applyReconciliationStep(model, { type: `restart` })
  expect(model.sourceRows).toEqual(
    new Map<SourceKey, SourceRow>([
      [0, row],
      [`0`, row],
    ]),
  )
  expect(model.sentRows).toEqual(model.sourceRows)
  expect(model.relation).toEqual(
    new Map([
      [expectedWeightedRowIdentity(0, row), 1],
      [expectedWeightedRowIdentity(`0`, row), 1],
    ]),
  )
})

it(`preserves external source rows across graph teardown and restart`, () => {
  const model = createReconciliationModel()
  const row = { id: 1, revision: 1, value: 1 }

  applyReconciliationStep(model, upsert(`row`, row))
  applyReconciliationStep(model, { type: `teardown` })
  expect(model.graphActive).toBe(false)
  expect(model.sourceRows).toEqual(new Map([[`row`, row]]))
  expect(model.sentRows).toEqual(new Map())
  expect(model.relation).toEqual(new Map())

  applyReconciliationStep(model, { type: `restart` })
  expect(model.graphActive).toBe(true)
  expect(model.sourceRows).toEqual(new Map([[`row`, row]]))
  expect(model.sentRows).toEqual(new Map([[`row`, row]]))
  expect(model.relation).toEqual(
    new Map([[expectedWeightedRowIdentity(`row`, row), 1]]),
  )
})

it(`replays external source changes made while the graph is down`, () => {
  const model = createReconciliationModel()
  const first = { id: 1, revision: 1, value: 1 }
  const replacement = { id: 1, revision: 2, value: 2 }

  applyReconciliationStep(model, upsert(`row`, first))
  applyReconciliationStep(model, { type: `teardown` })
  applyReconciliationStep(model, upsert(`row`, replacement, first))
  expect(model.sourceRows).toEqual(new Map([[`row`, replacement]]))
  expect(model.sentRows).toEqual(new Map())
  expect(model.relation).toEqual(new Map())

  applyReconciliationStep(model, { type: `restart` })
  expect(model.sourceRows).toEqual(new Map([[`row`, replacement]]))
  expect(model.sentRows).toEqual(new Map([[`row`, replacement]]))
  expect(model.relation).toEqual(
    new Map([[expectedWeightedRowIdentity(`row`, replacement), 1]]),
  )
})

function executedReplayReach(steps: ReadonlyArray<ReconciliationStep>): number {
  const model = createReconciliationModel()
  let sourceAtTeardown: Array<string> = []
  let completedChangedRestarts = 0
  for (const step of steps) {
    const activeBefore = model.graphActive
    if (step.type === `teardown` && activeBefore)
      sourceAtTeardown = snapshotModel(model).source
    applyReconciliationStep(model, step)
    if (step.type === `restart` && !activeBefore) {
      const replayed = snapshotModel(model).source
      if (
        sourceAtTeardown.length !== replayed.length ||
        sourceAtTeardown.some((value, index) => value !== replayed[index])
      )
        completedChangedRestarts++
    }
  }
  return completedChangedRestarts
}

it(`executes changed down-state sources and checks their restart replay`, () => {
  const histories = fc.sample(reconciliationHistoryArbitrary, {
    seed: 1780,
    numRuns: 500,
  })

  // Run every history, not just the first syntax match. Each accepted restart
  // has already passed tracker and signed-relation assertions above.
  const counts = histories.map((steps, sample) => {
    try {
      return executedReplayReach(steps)
    } catch (cause) {
      throw new Error(JSON.stringify({ seed: 1780, sample, steps }), { cause })
    }
  })
  expect(counts.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0)
})

it(`does not count absent replay or an unfinished downtime as replay coverage`, () => {
  const absent: ReconciliationStep = {
    type: `batch`,
    operations: [{ type: `replay`, key: `missing` }],
  }
  expect(
    executedReplayReach([{ type: `teardown` }, absent, { type: `restart` }]),
  ).toBe(0)
  const change = upsert(`row`, { id: 1, revision: 1, value: 1 })
  expect(executedReplayReach([{ type: `teardown` }, change])).toBe(0)
  expect(
    executedReplayReach([{ type: `teardown` }, change, { type: `restart` }]),
  ).toBe(1)
  expect(
    executedReplayReach([
      change,
      { type: `teardown` },
      change,
      { type: `restart` },
    ]),
  ).toBe(0)
})

fcTest.prop([sourceRowArbitrary, sourceKeyArbitrary], { numRuns: 100 })(
  `forces a changed source payload through every generated helper restart`,
  (row, key) => {
    const replacement = { ...row, revision: row.revision + 1 }
    expect(
      executedReplayReach([
        upsert(key, row),
        { type: `teardown` },
        upsert(key, replacement, row),
        { type: `restart` },
      ]),
    ).toBe(1)
  },
)

it.each([`upsert`, `rawUpdate`, `replay`, `restart`] as const)(
  `detects driver mutation at %s without changing expected source rows`,
  (entry) => {
    const model = createReconciliationModel()
    const row = { id: 1, revision: 1, value: 1 }
    const step: ReconciliationStep =
      entry === `restart`
        ? { type: `restart` }
        : entry === `replay`
          ? { type: `batch`, operations: [{ type: `replay`, key: `row` }] }
          : {
              type: `batch`,
              operations: [
                { type: entry, key: `row`, row, reportedPreviousValue: row },
              ],
            }
    if (entry === `restart` || entry === `replay`) {
      applyReconciliationStep(model, upsert(`row`, row))
      applyReconciliationStep(model, { type: `teardown` })
      if (entry === `replay`) model.graphActive = true
    }
    const corrupt: Reconciler = (changes, sent) => {
      for (const change of changes) change.value.value++
      return reconcileChangesForD2(changes, sent)
    }
    expect(() => applyReconciliationStep(model, step, corrupt)).toThrowError(
      expect.objectContaining({ name: `AssertionError` }),
    )
    expect(model.sourceRows.get(`row`)).toEqual({
      id: 1,
      revision: 1,
      value: 1,
    })
    expect(row).toEqual({ id: 1, revision: 1, value: 1 })
    // Fresh real helper control at the same entry, including restart hydration.
    const valid = createReconciliationModel()
    if (entry === `restart` || entry === `replay`) {
      applyReconciliationStep(valid, upsert(`row`, row))
      applyReconciliationStep(valid, { type: `teardown` })
      if (entry === `replay`) valid.graphActive = true
    }
    applyReconciliationStep(valid, step)
  },
)

fcTest.prop(
  [reconciliationHistoryArbitrary],
  oraclePropertyOptions(200, `d2-source.exact-retractions`),
)(
  `keeps one exact D2 contribution per source key across batched histories`,
  (steps) => {
    const model = createReconciliationModel()
    for (const step of steps) {
      applyReconciliationStep(model, step)
    }
  },
)

const assertDisjointHistoriesCommute = ([left, right]: [
  Array<SourceOperation>,
  Array<SourceOperation>,
]) => {
  const leftThenRight = createReconciliationModel()
  applyReconciliationStep(leftThenRight, { type: `batch`, operations: left })
  applyReconciliationStep(leftThenRight, { type: `batch`, operations: right })

  const rightThenLeft = createReconciliationModel()
  applyReconciliationStep(rightThenLeft, { type: `batch`, operations: right })
  applyReconciliationStep(rightThenLeft, { type: `batch`, operations: left })

  expect(snapshotModel(rightThenLeft)).toEqual(snapshotModel(leftThenRight))
}

fcTest.prop([disjointHistoriesArbitrary], {
  numRuns: oracleRuns(100),
  seed: 1781,
})(
  `commutes independent source histories for a fixed seed`,
  assertDisjointHistoriesCommute,
)

fcTest.prop(
  [disjointHistoriesArbitrary],
  oraclePropertyOptions(100, `d2-source.disjoint-commutation`),
)(
  `commutes independent source histories for a random or replayed seed`,
  assertDisjointHistoriesCommute,
)
